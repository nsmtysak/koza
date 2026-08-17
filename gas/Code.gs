/**
 * Kōza v2 — Claude API 中継プロキシ（Google Apps Script）
 *
 * 役割は3つだけ。
 *   1. 合言葉の照合
 *   2. Claude API への中継
 *   3. 顧客データを保存しない・ログに残さない
 *
 * ■ スクリプトプロパティ
 *   ANTHROPIC_API_KEY   Anthropic の APIキー
 *   TOKEN               アプリと共有する合言葉
 *   MODEL_FAST          省略可。既定 claude-haiku-4-5   （整理・名刺）
 *   MODEL_THINK         省略可。既定 claude-sonnet-5    （準備・段取り・文面）
 *
 * ■ 受け付ける依頼（mode）
 *   ping       つながるかの確認
 *   structure  話し言葉 → 来歴（haiku）
 *   card       名刺の画像 → 顧客情報（haiku）
 *   brief      これまでの履歴 → 会う前の準備（sonnet）
 *   plan       目標・不足・盤面 → 今日の段取り（sonnet）
 *   drafts     段取り → 送る文だけ（sonnet／plan と分けて待ち時間を半分にしている）
 *   invite     お誘いの文を型ごとに3案（sonnet）
 *
 * ■ デプロイ
 *   ウェブアプリ / 実行：自分 / アクセス：全員
 *   （全員でないとアプリから叩けない。だから合言葉を必須にしている）
 */

var API_URL = 'https://api.anthropic.com/v1/messages';
var API_VERSION = '2023-06-01';
var DEFAULT_FAST = 'claude-haiku-4-5';
var DEFAULT_THINK = 'claude-sonnet-5';

/* ============================================================
 * 入口
 * ============================================================ */

function doGet() {
  return json({ ok: true, data: { status: 'alive' } });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: '本文がありません' });
    }

    var req;
    try { req = JSON.parse(e.postData.contents); }
    catch (err) { return json({ ok: false, error: '本文がJSONではありません' }); }

    var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!expected) return json({ ok: false, error: 'サーバー側の合言葉が未設定です' });
    if (!safeEquals(String(req.token || ''), expected)) {
      return json({ ok: false, error: '合言葉が違います' });
    }

    switch (req.mode) {
      case 'ping':      return json({ ok: true, data: { status: 'ok', model: model('fast') } });
      case 'structure': return json(handleStructure(req));
      case 'card':      return json(handleCard(req));
      case 'brief':     return json(handleBrief(req));
      case 'plan':      return json(handlePlan(req));
      case 'invite':    return json(handleInvite(req));
      case 'drafts':    return json(handleDrafts(req));
      case 'daily':     return json(handlePlan(req));   // 旧名。互換のため残す
      default:          return json({ ok: false, error: '不明な依頼です: ' + req.mode });
    }
  } catch (err) {
    console.error(err);   // 顧客情報は載せない
    return json({ ok: false, error: 'サーバー側で問題が起きました' });
  }
}

/* ============================================================
 * 共通の前提（プロンプトの土台）
 * ============================================================ */

function industryPrimer(ctx) {
  ctx = ctx || {};
  var extra = [];
  if (ctx.shimei_system === 'jiyu') {
    extra.push('- この店は自由指名制です。口座は固定されず、ご来店ごとに指名が変わりえます。');
  }
  if (ctx.douhan_deadline) {
    extra.push('- 同伴は' + ctx.douhan_deadline + 'までに入店する必要があります。お誘いの際は時間の目安を添えます。');
  }
  if (ctx.douhan_timeout_min) {
    extra.push('- 同伴のタイムアウトは' + ctx.douhan_timeout_min + '分です。超えると切り返しになり、伝票が2枚になります。');
  }

  return [
    '# この仕事の前提',
    '- 高級クラブのホステスの記録係です。相手は「お客様」であり、敬意をもって書きます。',
    '- 係（かかり）＝そのお客様を担当するホステス。ヘルプ＝係を補助して同卓に付く役割。',
    '- 主客（shukyaku）＝その卓の中心のお客様。同行者（doukousha）＝主客が連れてこられた方。',
    '  法人接待が多く、誰が誰を連れてきたかは売上の構造そのものです。取りこぼさないでください。',
    '- 同伴＝出勤前に食事をして一緒に入店すること。',
    '- 切り返し＝同伴のタイムアウト超過で再入店扱いになり、伝票が2枚になること。',
    '- 飲み直し＝会計後にまた飲むこと。',
    '- セット＝席料の時間単位。',
    '',
    '# 口座と信頼（この仕事の根幹）',
    '- 口座＝そのお客様がどのホステスのものか。この業態では永久指名制の店が多く、',
    '  一度ついた口座は原則ずっとその方のものです。**口座は信頼関係そのものです。**',
    '- ですから、**ほかの方の口座のお客様に、こちらから連絡を差し上げてはいけません。**',
    '  越境は係の方の顔をつぶし、店の中で最も信を失う行為です。例外はありません。',
    '  ほかの方の口座のお客様にできるのは、ご来店くださったときに店内で丁寧にお相手し、',
    '  **係の方を立てること**だけです。',
    '- 自分の口座のお客様については、一度ついた信頼を毎回積み増すことが仕事です。',
    '  お約束を覚えている、前回の話の続きができる、お好みが用意されている。',
    '  この積み重ねだけが次のご来店になります。逆に、一度の粗相で口座は離れます。',
    '',
    extra.length ? '# この店のきまり\n' + extra.join('\n') + '\n' : ''
  ].filter(String).join('\n');
}

function objectivityRule() {
  return [
    '# 書き方のきまり',
    '本人が話した言葉を、組み立て直すだけです。**言い換えないでください。**',
    '',
    '- **原文の言い回しをできるだけ残します。** きれいな日本語に直す必要はありません。',
    '  「ちょっと疲れてる感じだった」は、そのまま「ちょっと疲れてる感じだった」で構いません。',
    '  何を書き、何を書かないかは、記録する本人が決めます。あなたが決めることではありません。',
    '- **原文に無いことは、一切足しません。** ここだけは絶対です。',
    '  例：原文が「ちょっと疲れてる感じだった」だけなのに',
    '      「いつもより口数が少なく」と足すのは捏造です。書いていないことは書かないでください。',
    '- 分からない項目は、空文字・0・null・空配列にします。埋めようとしないでください。',
    '- お客様のお名前は「様」付けに揃えます。ご家族の呼び方は一般的な形に（ご息女、ご子息、奥様）。',
    ''
  ].join('\n');
}

/**
 * お誘いの型。
 *
 * ホステス本人が持っていない視点を補うのがここの役目。
 * 「来てください」は相手に負担を渡す言い方で、断る理由を探させてしまう。
 * 行きたくなるのは、行く理由が相手の側にあるときだけ。
 */
function inviteStyles() {
  return [
    '# お誘いの型',
    '次の型から選びます。style には英語のキーを入れます。',
    '',
    '- info（お知らせにする）',
    '    お願いにしない。事実を伝えるだけにして、行くかどうかは相手に委ねます。',
    '    例「◯◯が入りましたので、お知らせまで。」',
    '- deadline（期限をつける）',
    '    今でないと無くなる、という事実を添えます。',
    '    **記録の中に、期限のある事実が実際にある場合しか使えません。**',
    '    ボトルの残量・季節のもの・催しの日取りなど、渡された記録に書かれていること限定です。',
    '    「頂いていたボトルが残り少なくなってまいりました」は、',
    '    **ボトルの残量が記録にあるときだけ**書けます。無いのに書けば作り話です。',
    '    渡された customer.bottles に「そろそろ空きます」があれば、そこを根拠にできます。',
    '    無ければ、この型は選ばず別の型にしてください。',
    '- star（相手を主役にする）',
    '    前回の話の続きを聞かせてほしい、という形。会話の記録があるときは最も効きます。',
    '    例「先日伺った◯◯の件、その後いかがでしたか。」',
    '- rely（教えを乞う）',
    '    頼られること自体が来る理由になります。相談・教えを乞う形にします。',
    '    例「◯◯のことで、少しお知恵をお借りしたくて。」',
    '- match（会わせたい方がいる）',
    '    別のお客様と引き合わせる。日付が決まっている分、動いていただきやすい形です。',
    '- choice（二択で伺う）',
    '    「いつでも」は返事を先送りさせます。日を2つ出して選んでいただきます。',
    '    例「木曜と金曜でしたら、どちらがご都合よろしいでしょうか。」',
    '- meal（お食事に誘う）',
    '    同伴のお誘いは、店ではなく食事の話にします。行きたい店がある、という形が自然です。',
    '    **同伴は、日・お店・待ち合わせの時刻の3つが決まって初めて成立します。**',
    '    店が決まっていない誘いは、必ずもう一往復します。往復が増えるほど流れます。',
    '    渡された記録にお好みの食べ物があれば、それに沿った形にしてください。',
    '- report（近況をお伝えする）',
    '    用件を作らない接触。返事が無くても構わない前提で送ります。関係を保つためのもの。',
    '',
    '# 事実の裏取り（守れないなら型を変える）',
    '文に入れてよいのは、**渡された記録に書かれていることだけ**です。',
    'ボトルの残量、季節のもの、催し、お客様の予定——**記録に無いものを「ある」ように書かない。**',
    'ホステス本人は、その文をそのままお客様に送ります。',
    '事実でなければ、その場で嘘がばれます。一度で信用を失います。',
    '',
    '# やってはいけないこと',
    '- 営業の匂いがする文（ご来店お待ちしております、ぜひ一度）',
    '- どなたにでも送れる文。その方だけに当てはまる要素が必ず要ります。',
    '- 既読の催促、返事の催促、間隔が空いたことへの言及（お久しぶりです、は可）',
    '- 情に訴える表現（寂しい、会いたい、待っています）',
    '- 来店・金額・同伴を急かす表現',
    '- ほかのお客様の話、ほかのお店の話、ほかのホステスの話',
    '- ご年齢に触れること',
    '- 深夜・早朝に読まれる前提の書き方（「今から」など）',
    '**一度でも重いと、二度と開いていただけません。軽さが最優先です。**',
    '',
    '# ご家庭への配慮',
    'ご家族の記録がある方には、ご家庭で見られても差し支えない文にします。',
    'お客様に恥をかかせるくらいなら、一組逃すほうがましです。',
    ''
  ].join('\n');
}

/* ============================================================
 * 1. 話し言葉 → 来歴＋プロフィール追記
 * ============================================================ */

function handleStructure(req) {
  var text = String(req.text || '').trim();
  if (!text) return { ok: false, error: '文章が空です' };

  var today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.today || ''))
    ? req.today : Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  var known = (req.known || []).slice(0, 300);
  var ctx = req.context || {};

  var knownText = known.length
    ? known.map(function (k) {
        return '- ' + k.name + (k.real ? '（' + k.real + '）' : '') + (k.company ? ' / ' + k.company : '');
      }).join('\n')
    : '（まだ登録がありません）';

  var system = [
    industryPrimer(ctx),
    '# あなたの仕事',
    '本人が帰り道に話した断片から、来歴を組み立てます。',
    'あわせて、その話から分かったお客様の情報（ご家族・趣味・お好み）を拾います。',
    '拾った情報は profile_updates に入れます。**本人が確認してから登録される**ので、',
    '確実でないものは入れないでください。推測で埋めてはいけません。',
    '',
    '# 出力のきまり',
    '- 今日は ' + today + ' です。「昨日」「先週の金曜」は実際の日付に直します。',
    '- customers[].name は、下の登録済み一覧にある方はその表記に合わせます。',
    '  一覧に無い方は、呼びかけに使える短い形（「田中」など）にします。',
    '- 金額は「8万」「10万くらい」などから円に直して spend に入れます。分からなければ null。',
    '- ボトルを入れていただいた場合は bottle に銘柄を入れます。',
    '- hooks は次に声をかけるきっかけになる事実です。拾えるだけ入れます。1件に絞りません。',
    '  commitment：口にされた約束（また来る、今度連れてくる）',
    '  family / work / health / hobby / event：次に様子を伺える話題',
    '  会話で盛り上がった話題は必ず入れます。例：「娘さんの受験の話」→ family「ご息女の受験の進捗」',
    '- appointments は、次のご来店の話が出たときだけ入れます。',
    '  「来週の金曜に寄る」→ 実際の日付に直して confirmed。「そのうちまた」→ 日が無いので入れません。',
    '  日が定まらない言い方（また来月）は next_visit_hint のほうに入れます。',
    '- 文中に無いことは足しません。分からない項目は空文字・0・null・空配列にします。',
    '- topic_detail は誰の話か分かるように書きます。お客様は「様」付け。',
    '  ご家族の呼び方は一般的な形に（ご息女、ご子息、奥様）。重ね敬語は使いません。',
    '',
    objectivityRule(),
    '# 登録済みのお客様',
    knownText,
    '',
  ].filter(String).join('\n');

  var schema = {
    type: 'object',
    properties: {
      visit_date: { type: 'string', description: 'YYYY-MM-DD' },
      customers: {
        type: 'array',
        description: 'ご一緒された方。特定できなければ空配列',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '登録済みならその表記。無ければ苗字' },
            role: { type: 'string', enum: ['shukyaku', 'doukousha', 'unknown'] },
            company: { type: 'string', description: '会社の手がかり。無ければ空文字' }
          },
          required: ['name', 'role', 'company'],
          additionalProperties: false
        }
      },
      my_role: { type: 'string', enum: ['kakari', 'help', 'unknown'] },
      douhan: { type: 'boolean' },
      kirikaeshi: { type: 'boolean' },
      nominaoshi: { type: 'boolean' },
      set_count: { type: 'integer', description: '不明なら0' },
      spend: { type: ['integer', 'null'], description: 'お会計の概算（円）。不明ならnull' },
      bottle: { type: 'string', description: '入れていただいたボトル。無ければ空文字' },
      topics: { type: 'array', items: { type: 'string' } },
      topic_detail: { type: 'string' },
      drinks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { item: { type: 'string' }, count: { type: 'integer' } },
          required: ['item', 'count'], additionalProperties: false
        }
      },
      next_visit_hint: {
        type: 'object',
        properties: {
          timing: { type: 'string', description: '例：2026-09上旬。不明なら空文字' },
          confidence: { type: 'string', enum: ['stated', 'implied', 'none'] }
        },
        required: ['timing', 'confidence'], additionalProperties: false
      },
      hooks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            type: { type: 'string', enum: ['family', 'work', 'health', 'hobby', 'commitment', 'event', 'other'] }
          },
          required: ['text', 'type'], additionalProperties: false
        }
      },
      observation: { type: 'string', description: '実際に観察された行動・発言のみ。無ければ空文字' },
      appointments: {
        type: 'array',
        description: '次のご来店の話が出た場合だけ。出ていなければ空配列',
        items: {
          type: 'object',
          properties: {
            customer: { type: 'string', description: '対象のお客様の名前' },
            date: { type: 'string', description: 'YYYY-MM-DD。「金曜」なら次の金曜の日付に直す。日が定まらなければ空文字' },
            kind: { type: 'string', enum: ['visit', 'douhan'] },
            confidence: {
              type: 'string',
              enum: ['confirmed', 'verbal'],
              description: 'confirmed＝日が決まった／verbal＝口約束'
            },
            note: { type: 'string', description: '原文での言い方。例：来週の金曜に寄る' }
          },
          required: ['customer', 'date', 'kind', 'confidence', 'note'],
          additionalProperties: false
        }
      },
      profile_updates: {
        type: 'array',
        description: '話から分かったお客様の情報。確実なものだけ',
        items: {
          type: 'object',
          properties: {
            customer: { type: 'string', description: '対象のお客様の名前' },
            interests: { type: 'array', items: { type: 'string' } },
            ng_topics: { type: 'array', items: { type: 'string' } },
            company: { type: 'string' },
            title: { type: 'string' },
            birthday: { type: 'string' },
            family: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  relation: { type: 'string', description: 'ご長女、奥様 など' },
                  name: { type: 'string' },
                  note: { type: 'string' }
                },
                required: ['relation', 'name', 'note'], additionalProperties: false
              }
            },
            prefs: {
              type: 'object',
              properties: {
                drinks: { type: 'array', items: { type: 'string' } },
                food: { type: 'array', items: { type: 'string' } },
                likes: { type: 'array', items: { type: 'string' } },
                dislikes: { type: 'array', items: { type: 'string' } }
              },
              required: ['drinks', 'food', 'likes', 'dislikes'], additionalProperties: false
            }
          },
          required: ['customer', 'interests', 'ng_topics', 'company', 'title', 'birthday', 'family', 'prefs'],
          additionalProperties: false
        }
      }
    },
    required: ['visit_date', 'customers', 'my_role', 'douhan', 'kirikaeshi', 'nominaoshi',
      'set_count', 'spend', 'bottle', 'topics', 'topic_detail', 'drinks',
      'next_visit_hint', 'hooks', 'observation', 'appointments', 'profile_updates'],
    additionalProperties: false
  };

  return callAndParse({
    model: model('fast'),
    max_tokens: 6000,
    system: system,
    messages: [{ role: 'user', content: text }],
    output_config: { format: { type: 'json_schema', schema: schema } }
  });
}

/* ============================================================
 * 2. 名刺 → お客様
 * ============================================================ */

function handleCard(req) {
  if (!req.image) return { ok: false, error: '画像がありません' };

  var system = [
    '名刺の画像から、記載されている情報をそのまま書き出します。',
    '',
    '# きまり',
    '- 書かれていないものは空文字にします。推測で埋めないでください。',
    '- 電話番号はハイフン付きの表記のまま。携帯（090/080/070）は mobile、それ以外は phone。',
    '- 会社名は法人格（株式会社など）を含めてそのまま。',
    '- display_name は「田中様」のように、姓＋様の形にします。',
    '- 読み取れない文字があれば、その項目は空文字にします。当て推量で埋めないでください。'
  ].join('\n');

  var schema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '氏名' },
      kana: { type: 'string', description: 'ふりがな。無ければ空文字' },
      display_name: { type: 'string', description: '姓＋様' },
      company: { type: 'string' },
      department: { type: 'string' },
      title: { type: 'string', description: '役職' },
      mobile: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string' },
      address: { type: 'string' }
    },
    required: ['name', 'kana', 'display_name', 'company', 'department', 'title',
      'mobile', 'phone', 'email', 'address'],
    additionalProperties: false
  };

  return callAndParse({
    model: model('fast'),
    max_tokens: 2000,
    system: system,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: req.media_type || 'image/jpeg', data: req.image } },
        { type: 'text', text: 'この名刺の内容を書き出してください。' }
      ]
    }],
    output_config: { format: { type: 'json_schema', schema: schema } }
  });
}

/* ============================================================
 * 3. 会う前の準備
 * ============================================================ */

function handleBrief(req) {
  var purpose = req.purpose === 'contact' ? 'contact' : 'visit';
  var ctx = req.context || {};

  var purposeText = purpose === 'contact'
    ? 'しばらくお会いしていないこの方に、こちらから連絡を差し上げる。'
    : 'この方が近くお見えになる。会う前に準備しておく。';

  var system = [
    industryPrimer(ctx),
    '# あなたの仕事',
    purposeText,
    'これまでの来歴・接点・お客様の情報を読み、本人がすぐ動ける形に落とします。',
    '',
    '# 守ること',
    '- **必ず根拠を添えます。** 各項目の basis に「いつの、どの記録から導いたか」を書きます。',
    '  記録に無いことを前提にしてはいけません。分からないことは書かないでください。',
    '- talk_points は「話せること」。相手が話したくなる具体的な話題にします。',
    '  「趣味の話をする」のような抽象的な指示は書きません。',
    '  「前回伺ったご息女の受験の結果」のように、その方だけに当てはまる形にします。',
    '- confirm_points は「確かめたいこと」。記録が曖昧で、次に会ったら埋めておきたい情報です。',
    '',
    '# seed_questions（ここがいちばん大事です）',
    'その場で伺っておくと、**次にご連絡する口実になる**質問を作ります。',
    'お客様づくりは、お会いしている今この時にしかできません。',
    '今日聞いておかなかったことは、次にご連絡するときの手ぶらになって返ってきます。',
    '',
    '良い質問の条件は2つです。',
    '  1. **答えに日付が入る。** 日付が入れば、その日にご連絡できます。',
    '     「ご出張はいつ頃ですか」「合格発表はいつですか」「新しいお店はいつ開くのですか」',
    '  2. **続きが生まれる。** 一度で終わらず、次に結果を伺える形になっている。',
    'intent には「これを伺っておくと、いつ・どういう連絡ができるか」を必ず書きます。',
    '答えが「はい／いいえ」で終わる質問は入れません。詰問にならない、自然な聞き方にします。',
    '2〜3件。渡された記録の中の話題から作ります。',
    '',
    '- cautions は店内での注意点と、触れない話題です。無ければ空配列。',
    '',
    '# hospitality（お迎えする側の手当て）',
    '**次にお越しいただけるかどうかは、今日の席の中で決まります。**',
    'その席で実際に手を動かすこと・用意しておくことを、具体的な行動として書きます。',
    '  「前回お飲みだった芋焼酎を、お座りになる前に用意しておく」',
    '  「頂いているボトルの残りをお伝えし、次を入れていただく話は自分からはしない」',
    '  「ご同席の方にも◯◯の話を振り、主客の顔が立つようにする」',
    '「丁寧に接する」のような、誰にでも当てはまることは書きません。',
    'この方の記録から導ける手当てだけを書きます。2〜4件。',
    '',
    '# offer（さりげなくお勧めできるもの）',
    '売上は「何組お迎えするか」と「一組あたりいくらか」の掛け算です。',
    '組数だけ追っても届きません。**その席で自然にお勧めできるものを1つ**出します。',
    '',
    '判断の材料は渡してあります。',
    '  - stats.average_spend … いつものお会計',
    '  - stats.max_spend … これまでに出された最高額（この方の上限の目安）',
    '  - stats.recent_spend … 直近の推移。落ちてきていれば、無理に上げない',
    '  - customer.prefs … お好みのお酒・食べ物',
    '  - customer.bottles … お預かりしているボトルと残量',
    '',
    '**押し売りは絶対にしません。** 次を守れないなら、offer は空にしてください。',
    '- お好みに沿っていること。飲まれないものを勧めない',
    '- いつものお会計から大きく外れないこと。max_spend を超える提案はしない',
    '- 直近が落ちてきている方には出さない（懐が厳しいことがあります）',
    '- お祝いごと・記念日・ボトルが空くなど、**理由のあるときだけ**',
    '- 言い方は「お勧めする」ではなく「ご用意できます」「入りました」',
    'why に、なぜ今この方にこれなのかを1文で。理由が書けないなら出さないでください。',
    '',
    '# trust_risks（信を落としかねない点）',
    'やらかすと口座が離れる、という具体的な危うさを書きます。',
    '  「前回◯◯をお約束しています。こちらから触れないと、軽く見られます」',
    '  「ご同席の△△様のほうが役職が上です。順番を違えないようにします」',
    '無ければ空配列にします。**無理に作らないでください。**',
    '',
    req.account_owner && req.account_owner !== 'self'
      ? '# この方は' + (req.account_owner === 'mama' ? 'ママ' : req.account_owner === 'free' ? 'フリー' : 'ほかの方') +
        'の口座です\n' +
        (req.account_owner === 'free'
          ? 'こちらからご連絡を差し上げても構いません。ご来店時に場内でご指名いただける下地をつくります。'
          : '**こちらからご連絡を差し上げてはいけません。** message_drafts は空配列にします。\n' +
            'できるのは店内でのお相手だけです。talk_points と hospitality は、係の方を立てる形で書きます。\n' +
            '「係の方より前に出ない」「係の方が話しやすいように場をつくる」ことを必ず含めます。')
      : '',
    '- message_drafts は2案。トーンを変え、そのまま送れる長さ（2〜4文）にします。',
    '  押しの強い言い回し、来店や金額を急かす表現は避けます。',
    '- 前回の準備と、その結果（outcome）が渡された場合は必ず踏まえます。',
    '  「役に立った」と評価された筋は伸ばし、「外していた」ものは繰り返しません。',
    '  同じ提案を出すときは、前回と違う角度から書いてください。',
    '',
    ctx.douhan_timeout_min ? '- この店の同伴タイムアウトは' + ctx.douhan_timeout_min + '分です。超えると切り返しになります。' : '',
    '',
    '# 文体',
    'ホステス本人が読みます。要点から先に、短く。敬語は自然な範囲で。'
  ].filter(String).join('\n');

  var point = {
    type: 'object',
    properties: {
      text: { type: 'string' },
      basis: { type: 'string', description: 'どの記録から導いたか。例：8/16の来店で伺った' }
    },
    required: ['text', 'basis'],
    additionalProperties: false
  };

  var schema = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'この方の今の状況を2〜3文で' },
      talk_points: { type: 'array', items: point },
      confirm_points: { type: 'array', items: point },
      cautions: { type: 'array', items: point },
      hospitality: { type: 'array', description: 'その席で実際にする手当て。2〜4件', items: point },
      trust_risks: { type: 'array', description: '信を落としかねない点。無ければ空配列', items: point },
      seed_questions: {
        type: 'array',
        description: '次のご連絡の口実になる質問。2〜3件',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'その場で伺う言葉。自然な聞き方で' },
            intent: { type: 'string', description: 'これを伺うと、いつ・どういうご連絡ができるようになるか' },
            basis: { type: 'string', description: 'どの記録から作ったか' }
          },
          required: ['question', 'intent', 'basis'],
          additionalProperties: false
        }
      },
      timing: { type: 'string', description: 'お声がけに向く曜日・時間帯とその理由' },
      message_drafts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tone: { type: 'string', description: '例：丁寧、やわらかい' },
            text: { type: 'string' }
          },
          required: ['tone', 'text'], additionalProperties: false
        }
      }
    },
    required: ['summary', 'talk_points', 'confirm_points', 'cautions',
      'hospitality', 'offer', 'trust_risks', 'seed_questions', 'timing', 'message_drafts'],
    additionalProperties: false
  };

  var payload = {
    customer: req.customer,
    stats: req.stats,
    recent_visits: req.recent_visits,
    touches: req.touches,
    open_hooks: req.open_hooks,
    last_brief: req.last_brief,
    today: req.today
  };

  return callAndParse({
    model: model('think'),
    max_tokens: 12000,
    system: system,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema } }
  });
}

/* ============================================================
 * 4. 逆算した段取り（このアプリの中心）
 *
 * 目標・不足・盤面・各方の推定値は、すべてアプリ側で計算済み。
 * ここでやるのは「その数字を前にして、今日と数日先に何をするか」の判断と言葉。
 * 計算はさせない。判断させる。
 * ============================================================ */

function handlePlan(req) {
  var p = req.progress || {};
  var cands = req.candidates || [];
  var guests = req.today_guests || [];
  var aftercare = req.aftercare || [];
  var boardText = req.board_text || '';
  var ctx = req.context || {};
  var gift = req.gift_season;

  /* 文面をここで書くと、返事が出そろうまで1分近くかかる。出勤前にそれは待てない。
   * 誰に・何を・なぜ今日か、までを先に返して、文面は mode:'drafts' で別に取る。 */
  var wantDraft = req.want_draft !== false;

  if (!cands.length && !guests.length && !aftercare.length) {
    return { ok: true, data: { headline: '', gap_comment: '', today: [], soon: [], skip: [], note: '' } };
  }

  var money = [];
  if (p.goal_sales) {
    money.push('# 目標に対して今どこにいるか');
    money.push('- ' + p.period_label + '（' + p.period_start + '〜' + p.period_end + '）');
    money.push('- 目標 ' + man(p.goal_sales) + '／実績 ' + man(p.actual) +
      '／予定分の見込み ' + man(p.booked) + '／このままの着地 ' + man(p.forecast));
    if (p.gap > 0) {
      money.push('- **不足 ' + man(p.gap) + '。残り ' + p.days_left + '日。**');
      if (p.need_visits) money.push('- 平均単価 ' + man(p.average_spend) + 'なので、あと' + p.need_visits + '組ほどお迎えできれば届きます。');
    } else {
      money.push('- 着地は目標を上回る見込みです。ここから先は積み増しと、来月に効く仕込みです。');
    }
    if (p.open_days_left !== undefined) {
      money.push('- 出られる日は残り ' + p.open_days_left + '日です（休みを除いた数）。');
    }
    if (p.final) {
      money.push('- **締めまで残りわずかです。**');
      money.push('  いま声をかけて間に合うのは、お越しになるまで ' + p.max_lead + '日以内の方だけです。');
      money.push('  それより時間のかかる方に今日動いても、今月の数字にはなりません。');
      money.push('  **間に合う方に絞ってください。** 間に合わない方は soon に回します。');
    }
    if (p.douhan_target) {
      money.push('- 同伴は目標' + p.douhan_target + '回に対して' + p.douhan_done + '回（予定分 ' + p.douhan_booked + '）。'
        + (p.douhan_need ? ' **あと' + p.douhan_need + '回。** 同伴は単価も上がり、枠は1日1組しか取れません。' : ''));
    }
    money.push('');
  }

  var system = [
    industryPrimer(ctx),
    '# あなたの仕事',
    '本日 ' + req.today + '（' + req.weekday + '）の出勤前に読む段取りを作ります。',
    'ただの「今日やること一覧」ではありません。**締め日に目標へ届かせるための逆算**です。',
    '',
    '# いちばん大事な考え方',
    '今日お迎えするお客様は、今日つくったのではありません。数日前の一手の結果です。',
    'ですから今日の仕事は、**3日後・5日後・1週間後の席を埋めること**です。',
    'アプリ側で、各お客様について次を計算してあります。',
    '  - target_date：その方に来ていただきたい日（空いている日・その方が来やすい曜日から選定済み）',
    '  - contact_by：その日に来ていただくために、声をかける締切（＝リードタイムぶん手前）',
    '  - urgency：late＝締切を過ぎている／today＝締切が今日／soon＝まだ先',
    '**contact_by が今日、または過ぎている方が、今日の仕事です。** ここを外さないでください。',
    '',
    aftercare.length ? [
      '# 先にやること：お礼（' + aftercare.length + '名）',
      aftercare.map(function (a) {
        return '- ' + a.name + '（' + a.days + '日前にご来店' + (a.douhan ? '・同伴' : '') + '）' +
          (a.topic ? ' 話題：' + a.topic : '');
      }).join('\n'),
      '**この方々へのお礼を、売上の逆算より先に置いてください。**',
      '永久指名制の店では、口座は信頼の積み上げです。来ていただいた翌日の一言があるかどうかで次が決まります。',
      '目先の一組より、信頼のほうが高くつきます。action は thanks を使います。',
      'お礼の文は、前回その場で話した具体の中身に触れます。「昨日はありがとうございました」だけでは何も残りません。',
      ''
    ].join('\n') : '',
    '# 口座について',
    '候補に挙がっているのは、こちらからご連絡してよい方だけです（アプリ側で絞ってあります）。',
    'それでも、ほかの方の口座のお客様に連絡を促すような書き方は絶対にしないでください。',
    '',
    money.join('\n'),
    boardText ? '# これから2週間の埋まり方\n' + boardText + '\n' : '',
    guests.length ? '# 本日お会いする方\n' + guests.map(function (g) {
      return '- ' + g.name + '（' + g.confidence + '）' + (g.last_topic ? ' 前回：' + g.last_topic : '');
    }).join('\n') + '\nこの方々には、店で何を話すかを store の行動として入れてください。\n' : '',
    '',
    inviteStyles(),
    '# 守ること',
    '- **候補にない方を足してはいけません。** id は必ず渡されたものを使います。',
    '- today には、contact_by が今日または過ぎている方を入れます。多くて6件。',
    '  お礼がまだの方は thanks として、**いちばん上に**入れます。',
    '  本日お会いする方がいれば、その方も store として today に入れます。',
    '- soon には、締切がまだ先の方を入れます。**do_on にいつ動くかの日付を必ず入れます。**',
    '  「そのうち」は書きません。日付で書きます。多くて4件。',
    '- skip は、候補にはあるが今は動かなくてよい方。理由を書きます。多くて3件。',
    '- reason は **渡された数字を使って** 1文で。',
    '  「ご無沙汰だから」ではなく「いつも21日ほどの間隔が、今日で41日」のように。',
    '- why_now は「なぜ今日なのか」を、target_date と結びつけて書きます。',
    '  例「金曜にお越しいただくには、今日お声がけしないと間に合いません」',
    '- action は thanks＝お礼／line＝連絡／douhan＝同伴のお誘い／store＝ご来店時に話す／gift＝ご挨拶を出す。',
    wantDraft ? [
      '- draft は thanks・line・douhan のときだけ、そのまま送れる2〜3文。ほかは空文字。',
      '  thanks の文には、その席で実際に話した中身を必ず入れます。定型のお礼は書きません。',
      '  **best_style が渡されている方には、その型を優先します。** 過去に効いた型だからです。',
      '  hooks（前回の会話から拾った事実）があれば、必ずそこを起点にします。',
      '  会話の記録から始まる誘いは、どなたにでも送れる文とは別物です。ここを手抜きしないでください。'
    ].join('\n') : [
      '- **draft はすべて空文字にしてください。** 送る文は別のお願いで作ります。',
      '  ここでのあなたの仕事は「誰に・何を・なぜ今日か」を決めきることです。',
      '  style（誘いの型）は選びます。文は書きません。'
    ].join('\n'),
    '- ng_topics に挙がっている話題には触れません。',
    '- headline は本日の方針を1文で。**数字を必ず1つ入れます。**',
    '- gap_comment は、不足に対する見立てを2文以内で。届きそうなら、そう言い切ります。',
    '- effort は本日の見込み作業量を「10分」のように短く。',
    '',
    gift ? '# ' + gift.label + 'の時期です。まだ' + gift.pending + '名お出しになっていません。' : '',
    ctx.douhan_quota_monthly ? '# 同伴の月間ノルマは' + ctx.douhan_quota_monthly + '本です。' : '',
    '',
    '# 文体',
    '本人が出勤前に読みます。短く、言い切る。迷わせない。',
    '**迷いを消すのがあなたの役目です。**'
  ].filter(String).join('\n');

  var ACTIONS = ['thanks', 'line', 'douhan', 'store', 'gift'];
  var WHENS = ['出勤前', '同伴の時間', '店内で', '帰り道', 'いつでも'];
  var STYLES = ['info', 'deadline', 'star', 'rely', 'match', 'choice', 'meal', 'report', ''];

  var todayItem = {
    type: 'object',
    properties: {
      id: { type: 'string', description: '渡された候補のid' },
      action: { type: 'string', enum: ACTIONS },
      when: { type: 'string', enum: WHENS },
      target_date: { type: 'string', description: 'この一手で来ていただきたい日。YYYY-MM-DD。store のときは空文字' },
      reason: { type: 'string', description: '数字を使って1文' },
      why_now: { type: 'string', description: 'なぜ今日なのか。target_date と結びつけて1文' },
      style: { type: 'string', enum: STYLES, description: 'line/douhan のときの誘いの型。ほかは空文字' },
      draft: {
        type: 'string',
        description: wantDraft ? 'line/douhan のときだけ。ほかは空文字' : '必ず空文字。文面は別で作る'
      }
    },
    required: ['id', 'action', 'when', 'target_date', 'reason', 'why_now', 'style', 'draft'],
    additionalProperties: false
  };

  var soonItem = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      action: { type: 'string', enum: ACTIONS },
      do_on: { type: 'string', description: 'いつ動くか。YYYY-MM-DD' },
      target_date: { type: 'string', description: '来ていただきたい日。YYYY-MM-DD' },
      reason: { type: 'string', description: 'なぜその日に動くのかを1文で' }
    },
    required: ['id', 'action', 'do_on', 'target_date', 'reason'],
    additionalProperties: false
  };

  var schema = {
    type: 'object',
    properties: {
      headline: { type: 'string', description: '本日の方針を1文で。数字を1つ入れる' },
      gap_comment: { type: 'string', description: '目標に対する見立て。2文以内。目標が無ければ空文字' },
      effort: { type: 'string', description: '本日の見込み作業量。例：10分' },
      today: { type: 'array', description: '今日やること。多くて5件。上から順に', items: todayItem },
      soon: { type: 'array', description: '数日以内に動くこと。多くて4件', items: soonItem },
      skip: {
        type: 'array',
        description: '今は動かなくてよい方。多くて3件',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            reason: { type: 'string', description: 'なぜ今でなくてよいか' }
          },
          required: ['id', 'reason'],
          additionalProperties: false
        }
      },
      note: { type: 'string', description: '補足。無ければ空文字' }
    },
    required: ['headline', 'gap_comment', 'effort', 'today', 'soon', 'skip', 'note'],
    additionalProperties: false
  };

  return callAndParse({
    model: model('think'),
    max_tokens: 12000,
    system: system,
    messages: [{
      role: 'user',
      content: JSON.stringify({ candidates: cands, today_guests: guests, aftercare: aftercare })
    }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema } }
  });
}

/* ============================================================
 * 4-b. 段取りの文面だけを、あとから
 *
 * 段取り（誰に・何を・なぜ今日か）と文面を1回でまとめると、
 * 出そろうまで1分近くかかる。出勤前にそれは待てない。
 * 判断は先に返し、文面はうしろで用意する。読んでいる間に埋まる。
 * ============================================================ */

function handleDrafts(req) {
  var people = req.people || [];
  var ctx = req.context || {};
  if (!people.length) return { ok: true, data: { drafts: [] } };

  var system = [
    industryPrimer(ctx),
    '# あなたの仕事',
    'ホステス本人がこれから送る文を書きます。段取り（誰に・何を・なぜ）はすでに決まっています。',
    'あなたが書くのは文だけです。判断はやり直さないでください。',
    '',
    '# 渡されるもの',
    '- action：thanks＝お礼／line＝ご連絡（お誘い）／douhan＝同伴のお誘い',
    '- style：選ばれたお誘いの型。thanks のときは空です',
    '- hooks：前回その席で実際に出た事実。**ここが文の起点です**',
    '- last_topic：前回のお話',
    '- target_date／target_weekday：お越しいただきたい日',
    '- thanks：お礼の場合、何日前にご来店で、同伴だったか',
    '- ng_topics：触れてはいけない話題',
    '',
    inviteStyles(),
    '# 書き方',
    '- そのまま LINE に貼って送れる形にします。2〜3文。前置きも署名も要りません。',
    '- **hooks か last_topic を必ず起点にします。** どなたにでも送れる文は書きません。',
    '  「お元気ですか」から始まる文は、送られた側にとって何の意味もありません。',
    '- お願いにしないでください。相手に判断の余地を残します。追いつめる文は口座を離します。',
    '- thanks は、その席で実際に話した中身に触れます。定型のお礼は書きません。',
    '  お礼にお誘いを混ぜないでください。お礼はお礼で終わります。下心が透けた時点で薄くなります。',
    '- douhan は、店ではなくお食事の話にします。日・お店・待ち合わせの時刻がそろって成立します。',
    '  お店に心当たりがなければ「お店は探しておきます」と書きます。作った店名は書きません。',
    '- 記録にないことを書いてはいけません。ボトルの残量も、催しも、渡されたものだけです。',
    '- ng_topics には触れません。',
    '- 絵文字は使いません。相手は年配の男性が多く、軽く見られます。',
    '',
    '# 文体',
    '敬語。丁寧だが、よそよそしくない。短い。'
  ].filter(String).join('\n');

  var schema = {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        description: '渡された人数ぶん、同じ id で返す',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '渡された id をそのまま' },
            text: { type: 'string', description: 'そのまま送れる文。2〜3文' }
          },
          required: ['id', 'text'],
          additionalProperties: false
        }
      }
    },
    required: ['drafts'],
    additionalProperties: false
  };

  return callAndParse({
    model: model('think'),
    max_tokens: 4000,
    system: system,
    messages: [{ role: 'user', content: JSON.stringify({ today: req.today, people: people }) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: schema } }
  });
}

/* ============================================================
 * 5. お誘いの文面
 *
 * 型ごとに書き分けて、本人に選んでいただく。
 * 「なぜこの型か」と「この型の危うさ」も添える。選ぶのは本人だから。
 * ============================================================ */

function handleInvite(req) {
  var c = req.customer || {};
  var ctx = req.context || {};

  var system = [
    industryPrimer(ctx),
    '# あなたの仕事',
    'このお客様に、' + (req.target_date ? req.target_date + '（' + req.target_weekday + '）' : '近いうち') +
      'お越しいただくためのご連絡を、型を変えて3案つくります。' +
      (req.kind === 'douhan' ? '**同伴のお誘い**です。' : ''),
    '本人がそのまま送れる形にします。手を入れる前提の下書きではありません。',
    '',
    '# 起点にすること',
    '前回までの会話から拾った事実（hooks）が渡されています。**必ずそこを起点にしてください。**',
    '会話の記録から始まる連絡と、どなたにでも送れる連絡は、受け取る側にとって別物です。',
    'hooks が空のときだけ、季節・時候・近況を起点にします。',
    '',
    inviteStyles(),
    '# 守ること',
    '- 3案は**必ず違う型**にします。同じ型を2つ出してはいけません。',
    '- best_style が渡されている場合、そのうち1案は必ずその型にします（過去に効いた型です）。',
    '- 各案に why（なぜこの型がこの方に効くか）と risk（この型の危うさ）を添えます。',
    '  risk は必ず書きます。「無し」は認めません。どの型にも外し方があります。',
    '- 2〜4文。長い文は開かれません。',
    '- ng_topics には触れません。',
    '- 日付を出す場合は渡された target_date を使います。勝手に別の日を作りません。',
    '- 記録に無いことを事実のように書いてはいけません。**作り話は信用を失います。**',
    '- best は3案のうちどれを推すか。番号（1〜3）で答え、理由を1文添えます。',
    '',
    ctx.douhan_timeout_min && req.kind === 'douhan'
      ? '- この店の同伴タイムアウトは' + ctx.douhan_timeout_min + '分です。時間の目安を添えると親切です。' : '',
    '',
    '# 文体',
    '高級クラブのホステスからのご連絡です。丁寧に、しかし固すぎず。短く。'
  ].filter(String).join('\n');

  var schema = {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        description: '3案。それぞれ違う型で',
        items: {
          type: 'object',
          properties: {
            style: { type: 'string', enum: ['info', 'deadline', 'star', 'rely', 'match', 'choice', 'meal', 'report'] },
            label: { type: 'string', description: 'この型の呼び名を日本語で短く' },
            text: { type: 'string', description: 'そのまま送れる本文。2〜4文' },
            why: { type: 'string', description: 'なぜこの型がこの方に効くか。1文' },
            risk: { type: 'string', description: 'この型の危うさ。1文。必ず書く' }
          },
          required: ['style', 'label', 'text', 'why', 'risk'],
          additionalProperties: false
        }
      },
      best: { type: 'integer', description: '推す案の番号（1〜3）' },
      best_reason: { type: 'string', description: 'なぜそれを推すか。1文' },
      send_timing: { type: 'string', description: '送るのに向く曜日・時間帯と、その理由を1文で' },
      follow_up: { type: 'string', description: '返事が無かった場合に、いつ・どうするか。1文' }
    },
    required: ['drafts', 'best', 'best_reason', 'send_timing', 'follow_up'],
    additionalProperties: false
  };

  return callAndParse({
    model: model('think'),
    max_tokens: 8000,
    system: system,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        customer: c,
        hooks: req.hooks || [],
        recent_visits: req.recent_visits || [],
        best_style: req.best_style || null,
        past_invites: req.past_invites || [],
        target_date: req.target_date || '',
        kind: req.kind || 'visit',
        today: req.today
      })
    }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema } }
  });
}

function man(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 10000) return Math.round(n / 10000) + '万円';
  return n + '円';
}

/* ============================================================
 * Claude API 呼び出し
 * ============================================================ */

function callAndParse(body) {
  var res = callClaude(body);
  if (!res.ok) return res;
  var parsed = parseJsonText(res.text);
  if (!parsed) return { ok: false, error: 'AIの返事を読み取れませんでした' };
  // 使った量は本文と別に返す。data に混ぜると各画面の読み取りに紛れ込む
  return { ok: true, data: parsed, usage: res.usage || null };
}

function callClaude(body) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'サーバー側のAPIキーが未設定です' };

  var res;
  try {
    res = UrlFetchApp.fetch(API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': API_VERSION },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, error: 'AIに繋がりませんでした' };
  }

  var code = res.getResponseCode();
  var raw = res.getContentText();

  if (code !== 200) {
    var msg = 'AIが応答しませんでした（' + code + '）';
    try {
      var ej = JSON.parse(raw);
      var t = ej && ej.error && ej.error.type;
      if (t === 'rate_limit_error') msg = '混み合っています。少し置いて試してください';
      else if (t === 'authentication_error') msg = 'APIキーが正しくありません';
      else if (t === 'overloaded_error') msg = 'AI側が混雑しています';
      else if (t === 'invalid_request_error') msg = '依頼の形が正しくありません';
    } catch (e) { /* 生の本文は返さない */ }
    return { ok: false, error: msg };
  }

  var data;
  try { data = JSON.parse(raw); }
  catch (e) { return { ok: false, error: 'AIの返事を読み取れませんでした' }; }

  if (data.stop_reason === 'refusal') return { ok: false, error: 'この内容は扱えませんでした' };
  if (data.stop_reason === 'max_tokens') return { ok: false, error: '内容が長すぎました。分けて試してください' };

  var text = '';
  (data.content || []).forEach(function (b) { if (b.type === 'text') text += b.text; });
  if (!text) return { ok: false, error: 'AIから中身が返りませんでした' };

  // 何トークン使ったかを持ち帰る。クレジットの減りは、推測ではなく実測で見せる
  var u = data.usage || {};
  return {
    ok: true,
    text: text,
    usage: {
      model: body.model || '',
      in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      out: u.output_tokens || 0
    }
  };
}

/* ============================================================
 * 補助
 * ============================================================ */

function model(kind) {
  var p = PropertiesService.getScriptProperties();
  if (kind === 'think') return p.getProperty('MODEL_THINK') || DEFAULT_THINK;
  return p.getProperty('MODEL_FAST') || DEFAULT_FAST;
}

function parseJsonText(text) {
  try { return JSON.parse(text); } catch (e) { /* 救済を試す */ }
  var s = text.indexOf('{'), t = text.lastIndexOf('}');
  if (s === -1 || t === -1 || t <= s) return null;
  try { return JSON.parse(text.substring(s, t + 1)); } catch (e) { return null; }
}

function safeEquals(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
