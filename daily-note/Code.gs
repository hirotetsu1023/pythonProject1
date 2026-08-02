/**
 * デイリーノート自動生成 (Google Apps Script)
 *
 * 毎晩21時に当日のノート YYYY-MM-DD.md を生成して Google Drive に保存する。
 *
 * データ源:
 *   - iPhone のカレンダー / リマインダー … iOS ショートカットが送るメール経由（ブリッジ）
 *   - Gmail                              … 当日受信分を Claude で「要対応 / 参考」に仕分け
 *
 * セットアップは README.md を参照。
 */

// ===== 設定 =====================================================================
const CONFIG = {
  // 出力先 Drive フォルダ ID
  FOLDER_ID: '16faJGYd-II6rDfpG_XYVAsfFW6WnTz8B',

  TIMEZONE: 'Asia/Tokyo',

  // iOS ショートカットが送るブリッジメールの件名マーカー
  BRIDGE_SUBJECT: 'DAILY-BRIDGE',

  // Gmail をさかのぼる件数の上限
  MAIL_MAX_THREADS: 40,

  // Claude API
  MODEL: 'claude-opus-5',
  // GAS の UrlFetchApp は 60 秒程度でタイムアウトするため effort は低めに固定
  EFFORT: 'low',
  // claude-opus-5 は思考が既定で有効で、思考と本文が同じ枠を共有する。
  // 枠が足りないと JSON が途中で切れるため、余裕を持たせておく。
  MAX_TOKENS: 8000,
};
// ================================================================================


/** 毎晩21時のトリガーを作成する（1回だけ実行すればよい）。 */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'generateDailyNote') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('generateDailyNote')
    .timeBased()
    .atHour(21)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();
  Logger.log('21時トリガーを作成しました');
}


/** メイン: 当日のデイリーノートを生成して Drive に保存する。 */
function generateDailyNote() {
  const today = new Date();
  const dateStr = fmt_(today, 'yyyy-MM-dd');
  const wd = ['日', '月', '火', '水', '木', '金', '土'][today.getDay()];

  const bridge = readBridge_();                   // iPhone 由来（予定・リマインダー）
  const mail = readMail_(today);                  // Gmail の生データ
  const ai = analyze_(dateStr, wd, bridge, mail); // Claude で「ひとこと」と仕分けを生成

  const md = buildMarkdown_(dateStr, wd, bridge, ai);
  const file = saveToDrive_(dateStr + '.md', md);
  Logger.log('出力完了: %s', file.getUrl());
  return file.getUrl();
}


// ===== ブリッジ（iPhone → メール → GAS） ========================================

/**
 * iOS ショートカットが送ったブリッジメールを読み、予定とリマインダーを取り出す。
 *
 * 期待する本文フォーマット（各行はそのまま表示に使う）:
 *   [CAL]
 *   09:00 もものクリニック 受診
 *   [CALNEXT]
 *   8/12(水) 17:00 再診
 *   [REM]
 *   書類提出
 *
 * 直近2日以内に届いたもののうち、最新の1通を採用する。
 *
 * @return {{today: !Array<string>, upcoming: !Array<string>, reminders: !Array<string>}}
 */
function readBridge_() {
  const empty = { today: [], upcoming: [], reminders: [] };
  const query = 'subject:' + CONFIG.BRIDGE_SUBJECT + ' newer_than:2d';
  const threads = GmailApp.search(query, 0, 5);
  if (threads.length === 0) {
    Logger.log('ブリッジメールが見つかりません（ショートカットが未実行の可能性）');
    return empty;
  }

  // 最新のメッセージを採用する
  let latest = null;
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (!latest || m.getDate() > latest.getDate()) latest = m;
    });
  });
  if (!latest) return empty;

  return parseBridgeBody_(latest.getPlainBody());
}


/**
 * ブリッジメール本文をセクションごとに分解する。
 * @param {string} body
 * @return {{today: !Array<string>, upcoming: !Array<string>, reminders: !Array<string>}}
 */
function parseBridgeBody_(body) {
  const out = { today: [], upcoming: [], reminders: [] };
  const sectionOf = { '[CAL]': 'today', '[CALNEXT]': 'upcoming', '[REM]': 'reminders' };
  let current = null;

  body.split(/\r?\n/).forEach(function (raw) {
    const line = raw.trim();
    if (line === '') return;

    const key = line.toUpperCase();
    if (sectionOf[key]) {
      current = sectionOf[key];
      return;
    }
    if (!current) return;

    // チェックボックス記法や箇条書き記号が付いていても取り除く
    const cleaned = line.replace(/^[-*・]\s*/, '').replace(/^\[[ xX]\]\s*/, '').trim();
    if (cleaned && cleaned !== CONFIG.BRIDGE_SUBJECT) out[current].push(cleaned);
  });

  return out;
}


// ===== Gmail ====================================================================

/**
 * 当日受信したメールの概要を集める。
 * @param {!Date} date
 * @return {!Array<{from: string, subject: string, snippet: string}>}
 */
function readMail_(date) {
  const next = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const query = 'after:' + fmt_(date, 'yyyy/MM/dd') +
                ' before:' + fmt_(next, 'yyyy/MM/dd') +
                ' -in:sent -in:draft -subject:' + CONFIG.BRIDGE_SUBJECT;

  return GmailApp.search(query, 0, CONFIG.MAIL_MAX_THREADS).map(function (t) {
    const m = t.getMessages()[0];
    return {
      from: m.getFrom(),
      subject: m.getSubject(),
      snippet: m.getPlainBody().slice(0, 300),
    };
  });
}


// ===== Claude ===================================================================

/**
 * 「今日のひとこと」とメールの仕分けを Claude に生成させる。
 * 失敗しても、ノート生成そのものは止めない（空の結果を返す）。
 *
 * @param {string} dateStr
 * @param {string} wd 曜日（1文字）
 * @param {!Object} bridge readBridge_ の戻り値
 * @param {!Array<!Object>} mail readMail_ の戻り値
 * @return {{hitokoto: string, actionable: !Array<string>, reference: !Array<string>}}
 */
function analyze_(dateStr, wd, bridge, mail) {
  // AI が使えないときは仕分けを諦め、その日のメールをそのまま参考欄に並べる。
  // 空欄にするより、件名が残っている方が後から見返せる。
  const fallback = {
    hitokoto: '',
    actionable: [],
    reference: mail.map(function (m) {
      return m.subject + '（' + senderName_(m.from) + '）';
    }),
  };

  const schema = {
    type: 'object',
    properties: {
      hitokoto: {
        type: 'string',
        description: '今日の予定と要対応メールを踏まえた、落ち着いた語りかけ調の1〜3文。',
      },
      actionable: {
        type: 'array',
        description: '対応が必要なメール。「送信元：要件（補足）」の形式。末尾に #タグ を1〜2個付ける。',
        items: { type: 'string' },
      },
      reference: {
        type: 'array',
        description: '対応不要な参考メール。似た内容はまとめて1行にする。',
        items: { type: 'string' },
      },
    },
    required: ['hitokoto', 'actionable', 'reference'],
    additionalProperties: false,
  };

  const payload = {
    model: CONFIG.MODEL,
    max_tokens: CONFIG.MAX_TOKENS,
    system:
      'あなたは日本語で書かれた個人のデイリーノートを整える編集者です。' +
      '事実を追加せず、与えられた情報だけを整理してください。' +
      'メールは「本人の対応が要るもの」と「案内・お知らせなど読むだけのもの」に分けます。' +
      '学会・セミナー案内やメールマガジンは原則 reference に入れ、' +
      '締切・提出物・申込・返信依頼があるものだけ actionable にしてください。',
    output_config: {
      effort: CONFIG.EFFORT,
      format: { type: 'json_schema', schema: schema },
    },
    messages: [{
      role: 'user',
      content:
        '日付: ' + dateStr + '（' + wd + '）\n\n' +
        '【今日の予定】\n' + (bridge.today.join('\n') || '(なし)') + '\n\n' +
        '【リマインダー】\n' + (bridge.reminders.join('\n') || '(なし)') + '\n\n' +
        '【今日届いたメール】\n' + JSON.stringify(mail, null, 1),
    }],
  };

  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) {
    Logger.log('ANTHROPIC_API_KEY が未設定のため AI 生成をスキップしました');
    return fallback;
  }

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('Claude API エラー (%s): %s', res.getResponseCode(), res.getContentText().slice(0, 500));
    return fallback;
  }

  const body = JSON.parse(res.getContentText());
  if (body.stop_reason === 'refusal') {
    Logger.log('Claude が応答を拒否しました');
    return fallback;
  }
  if (body.stop_reason === 'max_tokens') {
    // 応答が途中で切れており JSON として読めない。CONFIG.MAX_TOKENS を増やす。
    Logger.log('応答が max_tokens で打ち切られました（MAX_TOKENS を増やしてください）');
    return fallback;
  }

  const text = (body.content || []).filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('');
  try {
    const parsed = JSON.parse(text);
    return {
      hitokoto: parsed.hitokoto || '',
      actionable: parsed.actionable || [],
      reference: parsed.reference || [],
    };
  } catch (e) {
    Logger.log('応答の JSON 解析に失敗: %s', e.message);
    return fallback;
  }
}


// ===== Markdown 組み立て =========================================================

/**
 * ノート本文を組み立てる。
 * @param {string} dateStr
 * @param {string} wd
 * @param {!Object} bridge
 * @param {!Object} ai
 * @return {string}
 */
function buildMarkdown_(dateStr, wd, bridge, ai) {
  const wdFull = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(dateStr.replace(/-/g, '/')).getDay()
  ] + '曜日';

  const L = [];
  L.push('---', 'date: ' + dateStr, '曜日: ' + wdFull, 'tags: [daily]', '---', '');
  L.push('# ' + dateStr + ' (' + wd + ')', '');

  // ひとことが無い（AI 未使用）ときは、見出しごと省く
  if (ai.hitokoto) {
    L.push('> [!info] 今日のひとこと');
    ai.hitokoto.split(/\r?\n/).forEach(function (line) { L.push('> ' + line); });
    L.push('');
  }

  L.push('## 📅 今日の予定');
  pushList_(L, bridge.today, '- ', '- 予定なし');
  L.push('');

  L.push('## ✅ タスク / リマインダー');
  pushList_(L, bridge.reminders, '- [ ] ', '- ');
  L.push('');

  L.push('### 📨 メールから拾った要対応');
  pushList_(L, ai.actionable, '- [ ] ', '- [ ] （特になし）');
  L.push('');

  L.push('## 📥 受信トレイ・参考（対応不要）');
  pushList_(L, ai.reference, '- ', '- （特になし）');
  L.push('');

  L.push('## 🧠 振り返り / ジャーナル');
  L.push('- **今日よかったこと**: ');
  L.push('- **気づき・考えたこと**: ');
  L.push('- **手放したいこと・モヤモヤ**: ');
  L.push('- **明日意識すること**: ');
  L.push('');

  L.push('## 🔮 明日以降');
  pushList_(L, bridge.upcoming, '- ', '- 予定なし');
  L.push('');

  L.push('## 🔗 リンク');
  L.push('前日 [[' + shiftDate_(dateStr, -1) + ']] ｜ 翌日 [[' + shiftDate_(dateStr, 1) + ']] ｜ [[インデックス]]');
  L.push('');
  L.push('---');
  L.push('*このノートは毎晩21時に自動生成されています（カレンダー＋Gmail＋iPhoneリマインダー連携）*');

  return L.join('\n') + '\n';
}


/**
 * 配列を箇条書きとして push する。空なら fallback 行を入れる。
 * @param {!Array<string>} lines 出力先
 * @param {!Array<string>} items
 * @param {string} prefix
 * @param {string} fallback
 */
function pushList_(lines, items, prefix, fallback) {
  if (!items || items.length === 0) {
    lines.push(fallback);
    return;
  }
  items.forEach(function (item) { lines.push(prefix + item); });
}


// ===== ユーティリティ ============================================================

/**
 * 'Name <addr@example.com>' から表示名を取り出す。名前が無ければアドレスを返す。
 * @param {string} from
 * @return {string}
 */
function senderName_(from) {
  const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m && m[1].trim()) return m[1].trim();
  if (m) return m[2].trim();
  return String(from || '').trim();
}


/** Date を指定フォーマットの文字列にする。 */
function fmt_(date, pattern) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, pattern);
}


/** 'yyyy-MM-dd' を days 日ずらす。 */
function shiftDate_(dateStr, days) {
  const p = dateStr.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + days);
  return fmt_(d, 'yyyy-MM-dd');
}


/** Drive に保存する。同名ファイルが既にある場合は内容を差し替える。 */
function saveToDrive_(name, content) {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const existing = folder.getFilesByName(name);
  if (existing.hasNext()) {
    const file = existing.next();
    file.setContent(content);
    return file;
  }
  return folder.createFile(Utilities.newBlob(content, 'text/markdown', name));
}


// ===== メンテナンス ==============================================================

/**
 * 同名ノートの重複を掃除する（各ファイル名につき最新1件だけ残す）。
 * 削除ではなくゴミ箱への移動なので復元できる。
 */
function dedupeDailyNotes() {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const files = folder.getFiles();

  const byName = {};
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    (byName[name] = byName[name] || []).push(f);
  }

  let trashed = 0;
  Object.keys(byName).forEach(function (name) {
    const group = byName[name];
    if (group.length <= 1) return;
    group.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    group.slice(1).forEach(function (f) { f.setTrashed(true); trashed++; });
    Logger.log('%s: %s件 → 1件残し %s件をゴミ箱へ', name, group.length, group.length - 1);
  });
  Logger.log('合計 %s 件をゴミ箱に移動しました', trashed);
}


/** 疎通確認: ブリッジメールの解析結果をログに出す（Drive には書き込まない）。 */
function testBridge() {
  const bridge = readBridge_();
  Logger.log('今日の予定: %s', JSON.stringify(bridge.today));
  Logger.log('明日以降  : %s', JSON.stringify(bridge.upcoming));
  Logger.log('リマインダー: %s', JSON.stringify(bridge.reminders));
}
