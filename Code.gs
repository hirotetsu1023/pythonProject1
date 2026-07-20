/**
 * Google Chat → Markdown エクスポート (Google Apps Script)
 *
 * 指定スペースのメッセージを期間フィルタ付きで取得し、Markdown に整形して
 * Google Drive にテキストファイルとして出力する。
 *
 * セットアップは README.md を参照。
 */

// ===== 設定 =====================================================================
const CONFIG = {
  // 対象スペース (spaces/xxxxxxx)
  SPACE_ID: 'spaces/AAQAy4I4rHE',

  // 期間指定 (RFC 3339 / ISO 8601)。null なら全期間。
  // 例: '2026-01-01T00:00:00+09:00'
  START_TIME: null,
  END_TIME: null,

  // 1 ページあたりの取得件数 (Chat API 上限 1000)
  PAGE_SIZE: 100,

  // 出力ファイルのタイムゾーン
  TIMEZONE: 'Asia/Tokyo',

  // 出力先 Drive フォルダ ID ('' ならマイドライブ直下)
  OUTPUT_FOLDER_ID: '',

  // 送信者を表示名に解決するか (Directory / People API が必要。失敗時はリソース ID を使用)
  RESOLVE_SENDER_NAMES: true,
};
// ================================================================================


/**
 * メインエントリ: メッセージを取得 → Markdown 化 → Drive に保存。
 * @return {string} 保存したファイルの URL
 */
function exportChatToMarkdown() {
  const filter = buildTimeFilter_(CONFIG.START_TIME, CONFIG.END_TIME);
  const messages = listAllMessages_(CONFIG.SPACE_ID, filter);

  Logger.log('取得件数: %s', messages.length);
  if (messages.length === 0) {
    Logger.log('メッセージが見つかりませんでした（期間指定 / 権限を確認してください）');
  }

  const markdown = toMarkdown_(messages);
  const fileName = buildFileName_();
  const file = saveToDrive_(fileName, markdown);

  Logger.log('出力完了: %s', file.getUrl());
  return file.getUrl();
}


/**
 * スペース内の全メッセージをページネーションで取得する。
 * @param {string} spaceName 例: 'spaces/AAQAy4I4rHE'
 * @param {?string} filter createTime フィルタ文字列 (null 可)
 * @return {!Array<!Object>} createTime 昇順のメッセージ配列
 */
function listAllMessages_(spaceName, filter) {
  const messages = [];
  let pageToken = null;

  do {
    const optionalArgs = {
      pageSize: CONFIG.PAGE_SIZE,
      orderBy: 'createTime asc',
    };
    if (filter) optionalArgs.filter = filter;
    if (pageToken) optionalArgs.pageToken = pageToken;

    const response = Chat.Spaces.Messages.list(spaceName, optionalArgs);
    if (response.messages && response.messages.length > 0) {
      Array.prototype.push.apply(messages, response.messages);
    }
    pageToken = response.nextPageToken;
  } while (pageToken);

  return messages;
}


/**
 * START/END から Chat API の createTime フィルタ文字列を構築する。
 * @param {?string} start RFC 3339 文字列 or null
 * @param {?string} end   RFC 3339 文字列 or null
 * @return {?string} フィルタ文字列。両方 null なら null。
 */
function buildTimeFilter_(start, end) {
  const clauses = [];
  if (start) clauses.push('createTime > "' + start + '"');
  if (end) clauses.push('createTime < "' + end + '"');
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}


/**
 * メッセージ配列を Markdown 文字列に整形する。
 * @param {!Array<!Object>} messages
 * @return {string}
 */
function toMarkdown_(messages) {
  const senderCache = {};
  const lines = [];

  lines.push('# Google Chat エクスポート');
  lines.push('');
  lines.push('- スペース: `' + CONFIG.SPACE_ID + '`');
  lines.push('- 期間: ' + (CONFIG.START_TIME || '(指定なし)') + ' 〜 ' + (CONFIG.END_TIME || '(指定なし)'));
  lines.push('- 取得件数: ' + messages.length);
  lines.push('- 出力日時: ' + formatDate_(new Date().toISOString()));
  lines.push('');
  lines.push('---');
  lines.push('');

  messages.forEach(function (msg) {
    const time = formatDate_(msg.createTime);
    const sender = CONFIG.RESOLVE_SENDER_NAMES
      ? resolveSenderName_(msg.sender, senderCache)
      : (msg.sender && msg.sender.name) || '(不明)';
    const body = (msg.text || msg.formattedText || '(本文なし)').trim();

    lines.push('### ' + time + ' — ' + sender);
    lines.push('');
    lines.push(body);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}


/**
 * 送信者リソースを表示名に解決する。People API 失敗時はリソース ID にフォールバック。
 * @param {?Object} sender msg.sender (name: 'users/xxxx')
 * @param {!Object} cache リソース名 → 表示名 のキャッシュ
 * @return {string}
 */
function resolveSenderName_(sender, cache) {
  if (!sender || !sender.name) return '(不明)';
  const resource = sender.name; // 'users/1234567890'

  // Bot などは displayName がそのまま入っていることがある
  if (sender.displayName) return sender.displayName;
  if (cache[resource]) return cache[resource];

  const userId = resource.split('/')[1];
  let name = resource;
  try {
    const person = People.People.get('people/' + userId, {
      personFields: 'names',
    });
    if (person.names && person.names.length > 0) {
      name = person.names[0].displayName || resource;
    }
  } catch (e) {
    // 権限不足・見つからない場合はリソース ID のまま
    Logger.log('送信者名の解決に失敗 (%s): %s', resource, e.message);
  }

  cache[resource] = name;
  return name;
}


/**
 * ISO 文字列を 'yyyy-MM-dd HH:mm:ss' に整形する。
 * @param {string} isoString
 * @return {string}
 */
function formatDate_(isoString) {
  if (!isoString) return '(日時なし)';
  return Utilities.formatDate(new Date(isoString), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}


/**
 * 出力ファイル名を生成する。
 * @return {string}
 */
function buildFileName_() {
  const spaceShort = CONFIG.SPACE_ID.replace('spaces/', '');
  const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
  return 'chat_' + spaceShort + '_' + stamp + '.md';
}


/**
 * Markdown を Drive に保存する。
 * @param {string} fileName
 * @param {string} content
 * @return {!DriveFile}
 */
function saveToDrive_(fileName, content) {
  const blob = Utilities.newBlob(content, 'text/markdown', fileName);
  if (CONFIG.OUTPUT_FOLDER_ID) {
    return DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID).createFile(blob);
  }
  return DriveApp.createFile(blob);
}


// ===== 動作確認用 ===============================================================

/**
 * 疎通確認: 先頭 20 件をログ出力するだけ (Drive 出力なし)。
 */
function testListMessages() {
  const response = Chat.Spaces.Messages.list(CONFIG.SPACE_ID, { pageSize: 20 });
  if (!response.messages || response.messages.length === 0) {
    Logger.log('メッセージが見つかりません');
    return;
  }
  response.messages.forEach(function (msg) {
    Logger.log('%s | %s', msg.createTime, msg.text || '(本文なし)');
  });
}
