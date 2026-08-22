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
 *   TOKEN               アプリと共有する合言葉（1人で使うとき）
 *   LEDGER_ID           省略可。台帳のスプレッドシートID
 *                       入れると1人1鍵になり、使用量と上限をこちらで持つ
 *                       （setupLedger を実行すれば自動で入る）
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

    // 合言葉の照合。台帳があれば1人1鍵、無ければ従来の TOKEN ひとつ
    var auth = authorize_(req.token);
    if (!auth.ok) return json({ ok: false, error: auth.error });

    if (req.mode === 'ping') {
      // つながるかの確認は回数に数えない
      return json({ ok: true, data: { status: 'ok', model: model('fast'), name: auth.name || '' } });
    }

    var out;
    switch (req.mode) {
      case 'structure': out = handleStructure(req); break;
      case 'card':      out = handleCard(req); break;
      case 'brief':     out = handleBrief(req); break;
      case 'plan':      out = handlePlan(req); break;
      case 'invite':    out = handleInvite(req); break;
      case 'drafts':    out = handleDrafts(req); break;
      case 'daily':     out = handlePlan(req); break;   // 旧名。互換のため残す
      default:          return json({ ok: false, error: '不明な依頼です: ' + req.mode });
    }

    // 使った分を台帳に立てる。端末側の申告は当てにしない
    if (out && out.ok) ledgerRecord_(auth, out.usage);
    return json(out);
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
    '# はじめに — なぜお客様はクラブに来られるのか',
    'ここを外すと、あなたの出す答えは全部が的外れになります。用語より先に読んでください。',
    '',
    '家で飲む酒は安くて楽です。それでもお客様は出てこられます。',
    '家にいる限り「父」であり「夫」であることをやめられないからです。',
    '居酒屋が提供しているのは酒と肴と席で、**場を持たせる責任はお客様の側にあります。**',
    '部下を連れて行けば、そこでもまだ「上司」でいなければなりません。',
    '',
    'キャバクラとクラブは別のものです。ここを取り違えないでください。',
    '  キャバクラ … 若さ・数・にぎやかさ。指名は流動的。会話は**盛り上げる**もの。',
    '  クラブ　　 … 席の格と、続いていく関係。永久指名。会話は**受け止める**もの。',
    '**キャバクラは楽しませてもらう場所、クラブは分かってもらう場所です。**',
    '',
    'お客様が求めておられるのは、次の四つです。',
    '1. **役割を降りられて、しかも下がらない場所。**',
    '   会社では支店長でいなければならない。家では父でいなければならない。',
    '   ここでは両方を脱げる。にもかかわらず、支店長である自分を正しく扱ってもらえる。',
    '   降りられるが、下がらない。この二つが同時に成り立つ場所は、ほかにありません。',
    '2. **利害のない相手に話せること。** 部下には弱音を吐けず、同期はライバル、',
    '   妻には心配をかける。ただし、まったくの他人でも意味がありません。',
    '   **続けて自分を知っている人**でなければならない。',
    '3. **接待に使える格。** どこへ連れて行くかは、ご自分の格を示すことでもあります。',
    '4. **覚えていてもらえること。** 前に言ったことを覚えている人が、この街に一人いる。',
    '   家でも会社でも、もう得られないものです。',
    '',
    '# したがって、クラブが提供しているのは敬意です',
    '居酒屋にサービスはあっても、その方個人への敬意ではありません。',
    'キャバクラに好意はあっても、敬意ではありません。',
    'ご家庭に愛情はあっても、敬意は年月で摩耗します。会社に評価はあっても、敬意ではありません。',
    '',
    '**そして敬意は、記憶によってしか証明できません。**',
    '「大切に思っています」と言われても、前回の話を忘れられていれば嘘になります。',
    '逆に、何も言わなくても、前の話の続きが出てくれば伝わります。',
    '',
    '**あなたが扱っているのは、売上ではなく敬意そのものです。**',
    'この一行を、以下のすべての判断の土台にしてください。',
    '',
    '# 売上の置きどころ',
    '商売である以上、売上は必須です。**数字を追うことを否定しません。**',
    '',
    '人は放っておけば、何もしなくてよいほうへ流れます。**支える仕組みが要ります。**',
    '締め日までの不足が見えること、あと何組かが分かること、誰から動けばよいかが並ぶこと——',
    'これは本人を追い立てるためではなく、**動けるようにするため**にあります。',
    '根拠のない励ましでは人は動きません。**数字があるから動けます。**',
    'そして数字を出せるということは、**結果的に人のお役に立てているという証**でもあります。',
    '「お声がけから6組」は、売上の報告であると同時に、',
    '**6人の方にまた来ていただけた**という記録でもあります。同じ数字の裏表です。',
    '',
    '**ですから、本人の画面には数字をはっきり出してください。出し惜しみは要りません。**',
    '',
    '# 線は一箇所だけです',
    '  本人の画面　　 … 不足額・単価・組数・進捗。はっきり出す。それが動く理由になります',
    '  お客様に届く文 … 数字の匂いを一切残さない',
    '',
    'ここさえ守れば、数字はいくら見せて構いません。',
    'そのうえで、**お客様に届く言葉を書くときだけ**、次の見方に切り替えてください。',
    '  お客様の側から見れば、売上も締め日も関係がありません。',
    '  ✗「不足が120万。単価13万なのであと9組。この方は単価が高いので優先」',
    '  ○「前回ご息女の話をされたまま29日。いつもの間隔です。その続きを聞ける頃合いです」',
    '**上の数字がなければ本人は動けません。下の見方がなければ言葉が冷たくなります。**',
    '両方を持ってください。これは**文章を書くときの考え方の一つ**です。',
    '',
    '# 数字は、本人には燃料。お客様には見せない',
    'お会計の額、ご来店の間隔、その日のご様子——',
    '**お客様は、ご自分が数えられていることをご存じありません。**',
    'ご本人が話された事実を覚えているのは喜ばれますが、',
    '**話しておられない情報を踏まえた言動だと分かった瞬間、気味の悪さに変わります。**',
    '',
    'ですから、',
    '- 数字は、**本人が判断するために存分に**使います',
    '- **ただし、お客様に向かう言葉の材料には一切混ぜません**',
    '- 「前回が少なかったから今日は上積みを」——**これはやってはいけません**',
    '- 数字が言ってよいのは「**ここまでにしておきなさい**」だけです',
    '',
    '# その方について「今日は待つ」も、正しい提案です',
    '前回から日が浅い。お忙しそうだった。ご家庭に何かありそうだ。',
    'そういう方に声をかけないのは、怠慢ではなく仕事です。はっきり提案してください。',
    '売上のためだけの道具なら、この提案は出てきません。',
    '',
    '**ただし、これは「今日は何もしない」ではありません。**',
    '人は放っておけば動かないほうへ流れます。',
    '**個々の方について「今日は待つ」と言うのはよいのですが、**',
    '**その日全体を「動かなくてよい」と言ってはいけません。**',
    '手が空いている日に動かないのは、この仕事では損失です。',
    '',
    '# あなたは土台であって、主役ではありません',
    'ホステス本人には築いてきた年月があり、その時々の感性と気持ちで仕事をしています。',
    '**あなたの答えは100点にはなりません。**そこに本人の力が掛け合わさって、はじめて最高になります。',
    'ですから、判断を代行しないでください。**材料を揃えて、判断は本人に返してください。**',
    '文はそのまま送るものではなく、**下書き**です。最後の一言は必ず本人が足します。',
    '',
    'そして忘れないでください。',
    '**あなたが書いた文を、お客様はホステス本人の言葉として読み、その向こうに店の考え方を見ます。**',
    'あなたが軽率なら、店が軽率だと判断されます。',
    '',
    '# この仕事の言葉',
    '- 高級クラブのホステスの記録係です。相手は「お客様」であり、敬意をもって書きます。',
    '- 係（かかり）＝そのお客様を担当するホステス。ヘルプ＝係を補助して同卓に付く役割。',
    '- 主客（shukyaku）＝その卓の中心のお客様。同行者（doukousha）＝主客が連れてこられた方。',
    '  法人接待が多く、誰が誰を連れてきたかは売上の構造そのものです。取りこぼさないでください。',
    '- 同伴＝出勤前に食事をして一緒に入店すること。',
    '- 切り返し＝同伴のタイムアウト超過で再入店扱いになり、伝票が2枚になること。',
    '- 飲み直し＝会計後にまた飲むこと。',
    '- セット＝席料の時間単位。',
    '',
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
    '    **その方がそれを好むと分かる記録があるときだけ使えます。**',
    '    「響の17年が入りましたので、お知らせまで」だけでは、',
    '    入荷情報を全員に流しているのと同じに見えます。',
    '    お客様同士は見せ合います。同じ文が2人に届いた時点で、40人分の信用が揺らぎます。',
    '    例「以前お好きだとおっしゃっていた響、17年が入りましたのでお知らせまで。」',
    '    **「以前◯◯とおっしゃっていた」が書けないなら、この型は選ばないでください。**',
    '- deadline（期限をつける）',
    '    今でないと無くなる、という事実を添えます。',
    '    **記録の中に、期限のある事実が実際にある場合しか使えません。**',
    '    ボトルの残量・季節のもの・催しの日取りなど、渡された記録に書かれていること限定です。',
    '    「頂いていたボトルが残り少なくなってまいりました」は、',
    '    **ボトルの残量が記録にあるときだけ**書けます。無いのに書けば作り話です。',
    '    渡された customer.bottles に「そろそろ空きます」があれば、そこを根拠にできます。',
    '    無ければ、この型は選ばず別の型にしてください。',
    '    **この型は、率直に言って営業です。**上品に書けても、機能としては',
    '    「次も来て、次も注文して」と伝えています。だから続けて使うと、',
    '    「今月は数字が足りないのだろう」と受け取られます。**月に一度までにしてください。**',
    '- star（相手を主役にする）',
    '    前回の話の続きを聞かせてほしい、という形。会話の記録があるときは最も効きます。',
    '    例「先日伺った◯◯の件、その後いかがでしたか。」',
    '- rely（教えを乞う）',
    '    頼られること自体が来る理由になります。相談・教えを乞う形にします。',
    '    **何を聞きたいのかを、具体的に1つ書いてください。**',
    '    「お知恵をお借りしたく」だけでは、話題を作ったことが見抜かれます。',
    '    本当に知りたいなら、具体的な問いがあるはずだからです。',
    '    悪い例「ゴルフのことで少しお知恵をお借りしたく。」',
    '    良い例「お付き合いでラウンドに誘われたのですが、',
    '            初心者がまず揃えるべき道具について伺えたら心強いです。」',
    '- match（会わせたい方がいる）',
    '    別のお客様と引き合わせる。日付が決まっている分、動いていただきやすい形です。',
    '- choice（二択で伺う）',
    '    「いつでも」は返事を先送りさせます。日を2つ出して選んでいただきます。',
    '    **ただし、日付だけを単独で聞いてはいけません。**',
    '    前置きのない「木曜と金曜、どちらがご都合よろしいでしょうか」は、',
    '    どなたにでも送れてしまううえ、予定を埋めにきていることだけが伝わります。',
    '    **必ず、先に用件（お誘いする理由）を1文置いてから二択にしてください。**',
    '    **さらに、何にお誘いしているのかを必ず書いてください。**',
    '    前置きを足しただけでは足りません。話題だけ置いて日付を聞くと、',
    '    「結局は予定を聞かれているだけ」と受け取られます。着地点が要ります。',
    '    悪い例「今週でしたら木曜と金曜、どちらがご都合よろしいでしょうか。」',
    '    まだ足りない「先日の◯◯の続きを伺いたく。木曜と金曜でしたら…」',
    '            （何に誘っているのかが最後まで書かれていない）',
    '    良い例「先日の◯◯の続きを、一献差し上げながら伺えたらと存じます。',
    '            木曜と金曜でしたら、どちらがご都合よろしいでしょうか。」',
    '- meal（お食事に誘う）',
    '    同伴のお誘いは、店ではなく食事の話にします。行きたい店がある、という形が自然です。',
    '    **同伴は、日・お店・待ち合わせの時刻の3つが決まって初めて成立します。**',
    '    店が決まっていない誘いは、必ずもう一往復します。往復が増えるほど流れます。',
    '    渡された記録にお好みの食べ物があれば、それに沿った形にしてください。',
    '- work（お仕事と絡める）',
    '    その方のお仕事に、来る理由をつなげる形。',
    '    経費でも家庭でも説明が立つので、いちばん動いていただきやすい型です。',
    '    **その方の仕事の話が記録にあるときだけ使えます。**',
    '    日付は一日だけ、ゆるく限定します。「その日だけ」は圧になりません。',
    '    例「先日の名古屋の現場の続き、ちょうど水曜にお見えの方が',
    '        その手のお仕事にお詳しくて。お時間が合えば、その日だけご紹介できます。」',
    '- report（近況をお伝えする）',
    '    **実際にはこれが最も効く型です。**',
    '    前に伺った話について、こちらが調べた・見つけた・用意した、と伝える形。',
    '    お願いが一切入っていないのに、相手の側に「行く理由」ができます。',
    '    頼まれてもいないのに自分の時間を使ってくれた、と伝わるからです。',
    '    **何を調べたのか、その中身を必ず1つ書いてください。**',
    '    「少し調べてみました」だけでは、本当に調べたのかと勘ぐられます。',
    '    悪い例「先日おっしゃっていた将棋のこと、少し調べてみました。」',
    '    良い例「先日おっしゃっていた棋書、いい版が見つかりましたので',
    '            お持ちしておきますね。お忙しければ次の機会でも大丈夫です。」',
    '    **お渡しするものがあると、取りに来る理由になります。**それが最も強い形です。',
    '',
    '# 事実の裏取り（守れないなら型を変える）',
    '文に入れてよいのは、**渡された記録に書かれていることだけ**です。',
    'ボトルの残量、季節のもの、催し、お客様の予定——**記録に無いものを「ある」ように書かない。**',
    'ホステス本人は、その文をそのままお客様に送ります。',
    '事実でなければ、その場で嘘がばれます。一度で信用を失います。',
    '',
    '# 同じ型を続けない',
    'recent_styles に、直近でその方に使った型が入っています。',
    '**そこにある型は選ばないでください。**別の型にしてください。',
    'best_style（過去に効いた型）と重なっていても、直近に使っていれば避けます。',
    '効いた型でも、続ければテンプレだと気づかれます。そこで一度に信用を失います。',
    'お客様同士は文面を見せ合います。使い回しは必ず露見すると考えてください。',
    '',
    '# 結果がまだ出ていないことに踏み込まない',
    '試験・手術・商談・裁判・審査——**結果が確定していない出来事に、',
    'こちらから「その後いかがですか」と尋ねてはいけません。**',
    '良い結果なら最高の一通ですが、悪い結果だったとき、その一文は古傷に触れます。',
    '記録に結果が書かれていない限り、この種の話題は**こちらから触れない**でください。',
    'ご本人が報告してくださってから、はじめて話題にできます。',
    '',
    '# 結びの言い回しを揃えない',
    '安全な言い回しに寄せると、どの型も同じ結びになります。',
    '「また落ち着かれた頃に、ゆっくりお聞かせください」で全部を締めると、',
    '型を変えた意味がなくなり、**新しいテンプレ感**が生まれます。',
    'お礼、お誘い、ご報告——**結びはそれぞれ別の言い方にしてください。**',
    '複数の案を出すときは、結びが重ならないか必ず確かめてください。',
    '',
    '# やってはいけないこと',
    '- 営業の匂いがする文（ご来店お待ちしております、ぜひ一度）',
    '- どなたにでも送れる文。その方だけに当てはまる要素が必ず要ります。',
    '- 既読の催促、返事の催促、間隔が空いたことへの言及（お久しぶりです、は可）',
    '- 情に訴える表現（寂しい、会いたい、待っています）',
    '- 金額・単価・同伴の料金を、間接的にも匂わせること',
    '- ほかのお客様の話、ほかのお店の話、ほかのホステスの話',
    '- ご年齢に触れること',
    '- 深夜・早朝に読まれる前提の書き方（「今から」など）',
    '- 縁起の悪い言い方。とくにお酒とお付き合いの周りは言い換えます。',
    '  切れる／無くなる／終わる／尽きる／枯れる／最後',
    '    → 「残りわずかとなってまいりました」「お空けいただけましたら」',
    '  別れる／離れる／冷める／薄い／短い／失う',
    '    → その語を使わずに書き直します。',
    '**一度でも重いと、二度と開いていただけません。軽さが最優先です。**',
    '',
    '# 「急かす」と「決めて差し上げる」は別物です',
    '日にちや時刻を具体的に出すこと自体は、急かしているのではありません。',
    'お忙しい方にとっては、**決まっているほうが乗りやすい**のです。',
    '同伴のお誘いで「金曜の18時に本町で。お店はこちらで押さえておきます」と',
    '書くのは、押しつけではなく段取りです。むしろ喜ばれます。',
    '',
    '**分かれ目は、日時の具体性ではなく「断る余地が残っているか」です。**',
    '  可「いかがでしょうか」「ご都合が合えば」「難しければまたの機会に」',
    '  不可「お待ちしております」「空けておいてください」「必ずお越しください」',
    '',
    '**断りやすい一言を最後に添えてください。**',
    '「ご無理のないときにでも」「お忙しければ次の機会でも」の一言があると、',
    'かえって足が向きます。逃げ道のない誘いは、それだけで重くなります。',
    '',
    '**ただし、末尾に一言足せば済むわけではありません。**',
    'その前に既成事実（もう押さえた・もう決めた）を置いてしまうと、',
    '断る余地は言葉の上だけになり、実質の重みは既成事実のほうに残ります。',
    '  重い「お店は押さえておきます。ご無理のないときで結構です。」',
    '  軽い「お店はこちらで探しておきます。難しければ、またの機会に。」',
    '**まだ決めていない、という構えを文全体で保ってください。**',
    '',
    '# ご家庭への配慮',
    'ご家族の記録がある方には、ご家庭で見られても差し支えない文にします。',
    'お客様に恥をかかせるくらいなら、一組逃すほうがましです。',
    '',
    '**気をつけるのは、内容の際どさよりも「知りすぎていること」です。**',
    'ただし、細部を減らせばよいのではありません。**減らすと効かなくなります。**',
    '覚えていることが伝わる一文こそが、この仕事でいちばん効きます。',
    '',
    '**分けるのは数ではなく、ご家庭と共有されている事実かどうかです。**',
    '  使ってよい … ご家族もご存じのこと',
    '                （ご息女のご合格、ご旅行、お仕事のご栄転、気を揉んでおられたこと）',
    '  避ける     … その席でご本人だけがこぼされたこと',
    '                （願掛けで煙草を断っている、健康の数値、ご家庭の愚痴、',
    '                  ご家族に伏せておられる予定）',
    '',
    '前者は、ご家庭で見られても「よく気のつく店だ」で終わります。',
    '後者は、**「これは誰なのか」**という話になります。',
    'ご家族もご存じの事実であれば、遠慮なく具体的に書いてください。そこが効きます。',
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
        var already = [];
        if ((k.known_interests || []).length) already.push('趣味:' + k.known_interests.join('・'));
        if ((k.known_family || []).length) already.push('ご家族:' + k.known_family.join('・'));
        if ((k.known_drinks || []).length) already.push('お酒:' + k.known_drinks.join('・'));
        if ((k.known_foods || []).length) already.push('お食事:' + k.known_foods.join('・'));
        return '- ' + k.name + (k.real ? '（' + k.real + '）' : '') +
          (k.company ? ' / ' + k.company : '') +
          (already.length ? '\n    既に記録済み … ' + already.join(' / ') : '');
      }).join('\n')
    : '（まだ登録がありません）';

  var system = [
    industryPrimer(ctx),
    '# あなたの仕事',
    '本人が帰り道に話した断片から、来歴を組み立てます。',
    'あわせて、その話から分かったお客様の情報（ご家族・趣味・お好み）を拾います。',
    '**「既に記録済み」に入っていることは、profile_updates に出さないでください。**',
    'すでに趣味に「相撲」がある方に「趣味に相撲を追加」と出すと、',
    '記録を見ずに提案していることが分かります。的外れな候補が混ざると、',
    '**正しい候補まで読み飛ばされて、この機能ごと使われなくなります。**',
    '新しく分かったこと、または前より詳しくなったことだけを出してください。',
    '',
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
    '**そして、記録にある事実の範囲を出ないでください。**',
    'これは文を書くときの「記録にないことを書かない」と同じきまりの、会話版です。',
    '記録が「ご息女が最近よく話しかけてくるようになった」だけなら、',
    'それは**ご様子の変化**であって、部活も学校も成績も、ご本人は話しておられません。',
    '  ✗「お嬢様、部活は何をされているんですか」',
    '     （部活という具体は記録のどこにもない。良い話に便乗した詮索になります）',
    '  ○「思春期で難しい時期に、嬉しいことですね」',
    '     （記録の範囲に留まり、ご本人が話し出すのを待ちます）',
    '',
    'ご家族、とくにお子様のことは、**ご本人がどこまで話したいか分かりません。**',
    '踏み込むのは、ご本人が具体を口にされてからです。',
    '**質問は3つまで並べますが、席で全部を使うものではありません。**',
    '流れに乗ったものを一つ選んでいただく前提で書いてください。',
    '順番に消化されると、面接のようになって一度で見抜かれます。',
    '',
    '# cautions（気をつけること）は、2種類に分けます',
    '各項目の scope に、次のどちらかを入れてください。',
    '',
    '  personal … **この方だから**気をつけること。常に開いて見せます。',
    '      とくに値打ちがあるのは、**記録に「無い」ことから来る地雷**です。',
    '      例「奥様の記録がありません。ご結婚のことに踏み込まないでください」',
    '      「奥様もお元気ですか」は、現場でうっかり口にしやすい相槌です。',
    '      独身の方に言ってしまえば、その場が凍ります。',
    '      **書いてあることより、書いていないことに気づいてください。**',
    '',
    '  basic … **どなたにも当てはまる**基本。畳んで表示します。',
    '      例「健康の数値には触れない」「お会計のことは口にしない」',
    '      これは経験のある方には言うまでもないことです。',
    '',
    '**この分け方を守ってください。**当たり前のことが上に並ぶと、',
    '**その方だけの大事な一つまで読み飛ばされます。**',
    '無ければ空配列で構いません。埋めるために基本を並べないでください。',
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
    (req.watch_signs && req.watch_signs.length) ? [
      '# この方には、変わったかもしれない兆しが出ています',
      req.watch_signs.map(function (x) { return '- ' + x; }).join('\n'),
      '',
      '**今日は offer を空配列にしてください。何もお勧めしません。**',
      'お急ぎだったのかもしれない、ご事情があったのかもしれない——分かりません。',
      'そこへ一杯お勧めするのは、もてなしではなく数字を見て動いていることになります。',
      '',
      '代わりに hospitality へ、次のような手当てを入れてください。',
      '  - 長居をお願いしない。お帰りの間際に無理を言わない',
      '  - お好きな席・お好きな濃さを、何も言わずに用意しておく',
      '  - お忙しそうなら、それに気づいていると分かる一言を添える',
      '**今日は取り返す日ではありません。次にまた寄ろうと思っていただく日です。**',
      ''
    ].join('\n') : '',
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

  /* 気をつけることは2種類ある。
   * この方だから気をつけること（常に見せる）と、誰にでも当てはまる基本（畳む）。
   * 当たり前が上に並ぶと、その方だけの大事な一つが読み飛ばされる。 */
  var caution = {
    type: 'object',
    properties: {
      text: { type: 'string' },
      basis: { type: 'string', description: 'どの記録から導いたか。記録に無いことが理由ならそう書く' },
      scope: { type: 'string', enum: ['personal', 'basic'], description: 'personal＝この方だから／basic＝誰にでも' }
    },
    required: ['text', 'basis', 'scope'],
    additionalProperties: false
  };

  var schema = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'この方の今の状況を2〜3文で' },
      talk_points: { type: 'array', items: point },
      confirm_points: { type: 'array', items: point },
      cautions: { type: 'array', items: caution },
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
    'ただの「今日やること一覧」ではありません。**締め日から逆算した、今日の一手**です。',
    '不足も、あと何組かも、**はっきり伝えてください。根拠がないと人は動けません。**',
    '',
    'そのうえで、**draft（お客様に届く文）を書くときだけ**、次を思い出してください。',
    '**お客様の側から見れば、売上も締め日も関係がありません。**',
    'そこに書くのは「どの方との続きを進めるか」であって、「誰から取るか」ではありません。',
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
    '- skip は「**この方には今日は動かない**」という提案です。迷う時間を消すためのものです。',
    '  前回から日が浅い、お忙しそうだった、ご家庭に何かありそう——理由を書きます。多くて3件。',
    '  **ただし today を空にしてはいけません。**手が空いている日に誰にも動かないのは損失です。',
    '- reason は1文。**これは本人が読むものです。数字で言い切ってください。**',
    '  根拠がないと人は動けません。不足額・組数に触れても構いません。',
    '  「ご無沙汰だから」ではなく「いつも21日ほどの間隔が、今日で41日」。',
    '  **ただし draft（お客様に届く文）には、その数字を一切持ち込まないでください。**',
    '  判断の材料と、お渡しする言葉は、別のものです。',
    '- why_now は「なぜ今日なのか」を、target_date と結びつけて書きます。',
    '  例「金曜にお越しいただくには、今日お声がけしないと間に合いません」',
    '',
    '# 変わったかもしれない兆し（watch_signs）の扱い',
    '候補に watch_signs が付いていることがあります。',
    '前回のお会計が平均を下回った、いつもより早くお帰りになった、時計を気にされていた——',
    'こうした気づきです。**拾うことは正しい。ベテランが無意識にやっている読みです。**',
    '',
    '**しかし、解釈を一つに決めないでください。**',
    'お会計が下がったのは、離れかけているのかもしれません。',
    'その日たまたま急いでおられただけかもしれません。',
    'ご家庭が心地よくなって、早く帰りたくなっただけかもしれません。',
    '**どれも同じくらいありえます。悪いほうにだけ倒すのは、読みではなく思い込みです。**',
    '',
    'ですから、watch_signs があるときは、',
    '  1. **気づいたことを、そのまま書く**（「前回のお会計が10.8万。平均は13.0万です」）',
    '  2. **良い読みも一つ添える**（「ご家庭の話は明るい調子でした」）',
    '  3. **いつもの間隔を縮める理由にしない。**29日の方を14日で呼び戻す計画は立てません',
    '  4. **判断は本人に返す。**「気にしておいてください」で止めてよいのです',
    '',
    '兆しは、**急かす材料ではなく、目を配る材料**です。',
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
      '  style（誘いの型）は選びます。文は書きません。',
    '  **候補の recent_styles にある型は選ばないでください。**続けて同じ手は使いません。'
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
  var STYLES = ['info', 'deadline', 'star', 'rely', 'match', 'choice', 'meal', 'work', 'report', ''];

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
    '- recent_styles：直近その方に使った型。**ここにある型の言い回しに寄せないでください**',
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
    (req.recent_styles && req.recent_styles.length
      ? '- **直近この方に使った型は ' + req.recent_styles.join('、') + ' です。この型は3案に入れないでください。**'
      : ''),
    '- best_style が渡されている場合、そのうち1案は必ずその型にします（過去に効いた型です）。',
    '  **ただし直近に使った型と重なるときは、best_style より「続けない」ほうを優先します。**',
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
            style: { type: 'string', enum: ['info', 'deadline', 'star', 'rely', 'match', 'choice', 'meal', 'work', 'report'] },
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

/* ============================================================
 * 台帳（1人1つの合言葉）
 *
 * 1人で使っているうちは、スクリプトプロパティの TOKEN ひとつで足りる。
 * けれど複数の方にお配りするなら、それでは破綻する。
 *   - 1人が誰かに教えたら、全員が同じ鍵を使える
 *   - 誰がいくら使ったか分からない
 *   - 使いすぎを止められない
 *   - お辞めになった方を止められない
 *
 * そこでスプレッドシートを台帳にして、1人1行で持つ。
 * 端末側の申告は当てにしない。**数えるのはここだけ。**
 *
 * LEDGER_ID（スクリプトプロパティ）が無いときは、これまでどおり TOKEN で動く。
 * 1人で使っている間は、何も変えなくてよい。
 *
 * ■ 列（1行目は見出し）
 *   A 合言葉 / B お名前 / C 状態(有効・停止) / D 月の上限(回。0＝無制限)
 *   E 集計月 / F 今月の回数 / G 送ったトークン / H 返ったトークン
 *   I 最後に使った日時 / J 備考
 * ============================================================ */

var LEDGER_SHEET = 'users';
var LEDGER_HEAD = ['合言葉', 'お名前', '状態', '月の上限', '集計月', '今月の回数',
                   '送った', '返った', '最後に使った', '備考'];

function ledgerSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('LEDGER_ID');
  if (!id) return null;
  try {
    var ss = SpreadsheetApp.openById(id);
    return ss.getSheetByName(LEDGER_SHEET) || ss.getSheets()[0];
  } catch (e) {
    console.error('台帳を開けません');
    return null;
  }
}

function monthKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM');
}

/**
 * 合言葉を確かめて、使ってよいかを返す。
 * 台帳が無ければ、これまでどおり TOKEN ひとつで通す（1人用）。
 */
function authorize_(token) {
  token = String(token || '');
  if (!token) return { ok: false, error: '合言葉が違います' };

  var sh = ledgerSheet_();
  if (!sh) {
    var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!expected) return { ok: false, error: 'サーバー側の合言葉が未設定です' };
    if (!safeEquals(token, expected)) return { ok: false, error: '合言葉が違います' };
    return { ok: true, sheet: null, row: 0 };
  }

  var v = sh.getDataRange().getValues();
  var month = monthKey_();

  for (var i = 1; i < v.length; i++) {
    if (!safeEquals(String(v[i][0] || '').trim(), token)) continue;

    var status = String(v[i][2] || '').trim();
    if (status && status !== '有効') {
      return { ok: false, error: 'ご利用が止まっています。お手数ですが管理者にご連絡ください' };
    }

    // 月が変わっていたら、数え直しとして扱う
    var same = String(v[i][4] || '') === month;
    var calls = same ? Number(v[i][5] || 0) : 0;
    var limit = Number(v[i][3] || 0);
    if (limit > 0 && calls >= limit) {
      return { ok: false, error: '今月のご利用が上限に達しました。お手数ですが管理者にご連絡ください' };
    }

    return { ok: true, sheet: sh, row: i + 1, name: String(v[i][1] || ''), month: month };
  }
  return { ok: false, error: '合言葉が違います' };
}

/** 使った分を台帳に足す。ここが唯一の集計元 */
function ledgerRecord_(auth, usage) {
  if (!auth || !auth.sheet || !auth.row) return;

  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) { return; }   // 取れなければ数えない。止めるほどではない

  try {
    var sh = auth.sheet, r = auth.row;
    var cur = sh.getRange(r, 5, 1, 4).getValues()[0];        // E〜H
    var same = String(cur[0] || '') === auth.month;
    sh.getRange(r, 5, 1, 4).setValues([[
      auth.month,
      (same ? Number(cur[1] || 0) : 0) + 1,
      (same ? Number(cur[2] || 0) : 0) + ((usage && usage['in']) || 0),
      (same ? Number(cur[3] || 0) : 0) + ((usage && usage.out) || 0)
    ]]);
    sh.getRange(r, 9).setValue(new Date());
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------
 * ここから下は、エディタの「実行」から手で動かすもの
 * ------------------------------------------------------------ */

/** ① 台帳を作る。一度だけ実行する */
function setupLedger() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('LEDGER_ID')) {
    console.log('もうあります: ' + ledgerUrl());
    return;
  }
  var ss = SpreadsheetApp.create('Kōza 台帳');
  var sh = ss.getSheets()[0];
  sh.setName(LEDGER_SHEET);
  sh.getRange(1, 1, 1, LEDGER_HEAD.length).setValues([LEDGER_HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 260);
  props.setProperty('LEDGER_ID', ss.getId());
  console.log('台帳を作りました: ' + ss.getUrl());
  console.log('次は issueKey を実行して、1人目の合言葉を発行してください。');
}

/** ② 合言葉を1つ発行する。実行するたびに1行増える */
function issueKey() {
  var sh = ledgerSheet_();
  if (!sh) { console.log('先に setupLedger を実行してください'); return; }

  var key = 'k_' + Utilities.getUuid().replace(/-/g, '');
  sh.appendRow([key, '（お名前を入れてください）', '有効', 900, monthKey_(), 0, 0, 0, '', '']);
  console.log('発行しました。この1行をお渡しください。');
  console.log(key);
  console.log('※ 月の上限は900回にしてあります。台帳のD列で変えられます。');
  console.log('※ お名前は台帳のB列に直接お書きください。');
}

/** ③ 今の状況を見る */
function showLedger() {
  var sh = ledgerSheet_();
  if (!sh) { console.log('台帳がありません（1人用のまま動いています）'); return; }
  var v = sh.getDataRange().getValues();
  if (v.length < 2) { console.log('まだ誰も登録されていません'); return; }

  var month = monthKey_();
  var totalIn = 0, totalOut = 0;
  for (var i = 1; i < v.length; i++) {
    var same = String(v[i][4] || '') === month;
    var calls = same ? Number(v[i][5] || 0) : 0;
    var tin = same ? Number(v[i][6] || 0) : 0;
    var tout = same ? Number(v[i][7] || 0) : 0;
    totalIn += tin; totalOut += tout;
    console.log([
      (v[i][1] || '（名なし）'),
      (v[i][2] || '有効'),
      calls + '回',
      '送' + tin + ' / 返' + tout,
      '鍵…' + String(v[i][0]).slice(-6)
    ].join('　'));
  }
  // ざっくりの目安。正確な請求は Anthropic の管理画面で見ること
  var usd = (totalIn / 1e6) * 3 + (totalOut / 1e6) * 15;
  console.log('---');
  console.log(month + ' 合計　送' + totalIn + ' / 返' + totalOut +
    '　おおよそ $' + (Math.round(usd * 100) / 100));
}

/** ④ 止める・戻す。台帳のC列を直接書き換えても同じ */
function suspendKey() {
  console.log('台帳のC列を「停止」に書き換えてください。次の呼び出しから止まります。');
  console.log(ledgerUrl());
}

function ledgerUrl() {
  var id = PropertiesService.getScriptProperties().getProperty('LEDGER_ID');
  return id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : '（台帳なし）';
}
