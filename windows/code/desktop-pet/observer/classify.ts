/**
 * 用户当前在做什么 —— 只依据本机的前台窗口与空闲时长推断。
 *
 * 设计边界（与陪伴记忆分开）：
 *   * 纯本地规则，不发网络请求、不花 API 钱、不读屏幕内容
 *   * 只看「进程名 + 窗口标题 + 空闲时长 + 是否全屏」
 *   * 分类结果同时是「我感知到什么」与「我该不该主动说话」的唯一依据
 */

export const ACTIVITY_KINDS = [
  'gaming', 'meeting', 'coding', 'writing', 'watching', 'music',
  'chatting', 'browsing', 'dsh-work', 'idle', 'away', 'unknown',
] as const;
export type ActivityKind = typeof ACTIVITY_KINDS[number];

/** 打扰等级，由弱到强。 */
export type DisturbLevel = 'silent' | 'quiet' | 'ambient' | 'open' | 'invite';

export interface ForegroundSample {
  /** 前台窗口标题。可能含文件名或网页标题，仅在本机使用。 */
  readonly title: string;
  /** 进程名，不含 .exe，小写比较。 */
  readonly process: string;
  /** 距上次键鼠输入经过的毫秒数。 */
  readonly idleMs: number;
  /** 窗口覆盖显示器的面积比是否达到全屏阈值。 */
  readonly fullscreen: boolean;
  /** 采样时刻（ISO）。 */
  readonly at: string;
}

export interface ActivityReading {
  readonly kind: ActivityKind;
  /** 对用户的中文描述，可直接展示。 */
  readonly label: string;
  readonly disturb: DisturbLevel;
  /** 桌宠理解这件事的理由，供提示词使用。 */
  readonly reason: string;
  readonly idleMs: number;
  readonly process: string;
  readonly title: string;
  readonly fullscreen: boolean;
  readonly at: string;
}

export interface ClassifyThresholds {
  /** 超过这个空闲时长算「离开座位」。 */
  readonly awayMs: number;
  /** 超过这个空闲时长算「闲下来」。 */
  readonly idleMs: number;
}

export const DEFAULT_THRESHOLDS: ClassifyThresholds = Object.freeze({ awayMs: 5 * 60_000, idleMs: 75_000 });

// ---- 进程表：小写、不含 .exe ----

const GAME_PROCS = new Set([
  'genshinimpact', 'yuanshen', 'starrail', 'bh3', 'hyp', 'zenlesszonezero',
  'league of legends', 'leagueclient', 'leagueclientux', 'valorant', 'valorant-win64-shipping',
  'cs2', 'csgo', 'dota2', 'overwatch', 'destiny2', 'apex_legends', 'r5apex',
  'pubg', 'escapefromtarkov', 'rustclient', 'dayz',
  'eldenring', 'sekiro', 'darksoulsiii', 'armoredcore6',
  'cyberpunk2077', 'witcher3', 'rdr2', 'gta5', 'gtav', 'gta5_enhanced',
  'minecraft', 'terraria', 'stardew valley',
  'forzahorizon5', 'fh5', 'assettocorsa', 'iracing',
  'monsterhunterworld', 'monsterhunterrise', 'mhw',
  'baldurs gate 3', 'bg3', 'pathofexile', 'pathofexile_x64',
  'arknights', 'bluearchive', 'nikke', 'wutheringwaves',
  'ffxiv_dx11', 'ffxiv', 'wow', 'wowclassic', 'tslgame',
]);

/** 游戏平台 / 启动器：只有同时全屏才判为游戏，避免把挂着启动器的浏览器误判。 */
const GAME_LAUNCHERS = new Set([
  'steam', 'steamwebhelper', 'epicgameslauncher', 'battle.net', 'riotclientservices',
  'ubisoftconnect', 'eaapp', 'origin', 'gog galaxy', 'playnite', 'mihoyolauncher',
  'hyp-launcher', 'wegame', 'tgp', 'grasscutter',
]);

/** 游戏标题里的强信号词：必须叠加全屏才算，否则会把「项目名里带 Game」的窗口误判。 */
const GAME_TITLE_HINTS = [
  '原神', '崩坏', '星穹铁道', '绝区零', '鸣潮', '明日方舟', '蔚蓝档案', '碧蓝航线',
  '英雄联盟', '无畏契约', '守望先锋', '绝地求生', '永劫无间', '穿越火线', '地下城与勇士',
  'steam', 'epic games', 'battle.net',
];

const MEETING_PROCS = new Set([
  'zoom', 'teams', 'ms-teams', 'webexmta', 'webex', 'dingtalk', 'wemeetapp', 'voov',
  'tencentmeeting', 'feishu', 'lark', 'slack', 'discord', 'skypeapp', 'skype',
]);
const MEETING_TITLE_HINTS = ['会议', '通话', 'meeting', '正在共享', '共享屏幕', '语音频道', '视频通话'];

const CODING_PROCS = new Set([
  'code', 'code - insiders', 'cursor', 'windsurf', 'devenv', 'rider64', 'idea64', 'pycharm64',
  'webstorm64', 'goland64', 'clion64', 'phpstorm64', 'rustrover64', 'sublime_text', 'notepad++',
  'gvim', 'nvim', 'emacs', 'windowsterminal', 'wt', 'powershell', 'pwsh', 'cmd', 'conhost',
  'bash', 'wsl', 'mintty', 'git-bash', 'github desktop', 'sourcetree', 'gitkraken', 'postman',
  'insomnia', 'docker desktop', 'dbeaver', 'navicat', 'heidisql', 'redisinsight', 'vim', 'zed',
]);
const CODING_TITLE_HINTS = ['.ts', '.tsx', '.js', '.mjs', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.css', '.html', '.json', '.yml', '.yaml', '.sql', '.sh', '.ps1', 'visual studio', 'github', 'gitlab', 'pull request'];

const WRITING_PROCS = new Set(['winword', 'wps', 'et', 'wpp', 'powerpnt', 'excel', 'onenote', 'acrord32', 'acrobat', 'sumatrapdf', 'typora', 'obsidian', 'notion', 'logseq', 'joplin', 'zotero', 'mendeley', 'xmind', 'mindmaster']);
const WRITING_TITLE_HINTS = ['.doc', '.docx', '.md', '.txt', '.pdf', '.ppt', '.pptx', '.xlsx', '.xls', 'word', 'excel', 'powerpoint', '文档', '论文', '报告', '笔记'];

const WATCHING_PROCS = new Set(['potplayer', 'potplayermini64', 'vlc', 'mpc-hc64', 'mpc-be64', 'kmplayer64', 'mpv', 'bilibili', '哔哩哔哩', 'iqiyi', 'qqlive', 'youku', 'mgtv', 'douyu', 'huya', 'obs64', 'youtube', 'netflix']);
const WATCHING_TITLE_HINTS = ['bilibili', '哔哩哔哩', 'youtube', 'netflix', '爱奇艺', '腾讯视频', '优酷', '芒果', '斗鱼', '虎牙', '直播', '电影', '动漫', '番剧', '视频'];

const MUSIC_PROCS = new Set(['cloudmusic', 'qqmusic', 'kugou', 'kuwo', 'spotify', 'foobar2000', 'aimp', 'musicbee', 'netease', 'spotifyab']);
const MUSIC_TITLE_HINTS = ['网易云音乐', 'qq音乐', '酷狗', '酷我', 'spotify', '音乐'];

const CHATTING_PROCS = new Set(['wechat', 'weixin', 'qq', 'tim', 'telegram', 'whatsapp', 'line', 'signal', 'messenger', 'dingtalk', 'aliwangwang', 'feishu']);
const CHATTING_TITLE_HINTS = ['微信', 'wechat', 'telegram', '聊天'];

const BROWSER_PROCS = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'iexplore', '360se', '360chrome', 'sogouexplorer', 'qqbrowser', 'liebao', 'maxthon']);

/** 与我一起干活：DSH 自身的窗口。不属于「工作转交」，只是识别出用户在跟我协作。 */
const DSH_PROCS = new Set(['deepseek harness', 'dsh', 'electron']);
const DSH_TITLE_HINTS = ['deepseek harness', 'dsh'];

const ACTIVITY_LABELS: Readonly<Record<ActivityKind, string>> = Object.freeze({
  gaming: '在打游戏', meeting: '在开会或通话', coding: '在写代码', writing: '在写文档',
  watching: '在看视频', music: '在听音乐', chatting: '在聊天', browsing: '在浏览网页',
  'dsh-work': '在和我一起干活', idle: '闲下来了', away: '不在座位上', unknown: '状态不明',
});

/** 每种活动的打扰策略：silent 完全不出声，invite 最适合主动关心。 */
const DISTURB: Readonly<Record<ActivityKind, DisturbLevel>> = Object.freeze({
  gaming: 'silent', meeting: 'silent', away: 'silent',
  coding: 'quiet', writing: 'quiet',
  watching: 'ambient', music: 'ambient', unknown: 'quiet',
  chatting: 'open', browsing: 'open', 'dsh-work': 'open',
  idle: 'invite',
});

export function disturbFor(kind: ActivityKind): DisturbLevel {
  return DISTURB[kind];
}

export function labelFor(kind: ActivityKind): string {
  return ACTIVITY_LABELS[kind];
}

/** 主动开口的依据：只有 invite / open 才允许桌宠先说话。 */
export function maySpeakFirst(kind: ActivityKind): boolean {
  return DISTURB[kind] === 'invite' || DISTURB[kind] === 'open';
}

const has = (hints: readonly string[], text: string): boolean => hints.some(hint => text.includes(hint));

/**
 * 把一次前台采样归纳成活动状态。
 *
 * 判定顺序即优先级：离开 > 游戏 > 会议 > 写代码 > 写文档 > 看视频 > 听音乐 > 聊天 > 和我干活 > 浏览 > 闲置。
 * 标题类信号一律要求「进程不认识」时才使用，且游戏标题必须叠加全屏。
 */
export function classifyActivity(sample: ForegroundSample, thresholds: ClassifyThresholds = DEFAULT_THRESHOLDS): ActivityReading {
  const process = (sample.process || '').trim().toLowerCase();
  const title = (sample.title || '').trim();
  const lowerTitle = title.toLowerCase();
  const kind = decide(process, lowerTitle, sample, thresholds);
  return {
    kind,
    label: ACTIVITY_LABELS[kind],
    disturb: DISTURB[kind],
    reason: reasonFor(kind, process, title),
    idleMs: sample.idleMs,
    process,
    title,
    fullscreen: sample.fullscreen,
    at: sample.at,
  };
}

function decide(process: string, title: string, sample: ForegroundSample, thresholds: ClassifyThresholds): ActivityKind {
  if (sample.idleMs >= thresholds.awayMs) return 'away';
  if (GAME_PROCS.has(process)) return 'gaming';
  if (GAME_LAUNCHERS.has(process) && sample.fullscreen) return 'gaming';
  // 标题类游戏信号必须叠加全屏：否则「项目名里带 Game」的窗口会误判。
  if (sample.fullscreen && has(GAME_TITLE_HINTS, title)) return 'gaming';
  if (MEETING_PROCS.has(process) || has(MEETING_TITLE_HINTS, title)) return 'meeting';
  if (CODING_PROCS.has(process) || has(CODING_TITLE_HINTS, title)) return 'coding';
  if (WRITING_PROCS.has(process) || has(WRITING_TITLE_HINTS, title)) return 'writing';
  if (WATCHING_PROCS.has(process) || has(WATCHING_TITLE_HINTS, title)) return 'watching';
  if (MUSIC_PROCS.has(process) || has(MUSIC_TITLE_HINTS, title)) return 'music';
  if (CHATTING_PROCS.has(process) || has(CHATTING_TITLE_HINTS, title)) return 'chatting';
  if (DSH_PROCS.has(process) || has(DSH_TITLE_HINTS, title)) return 'dsh-work';
  if (BROWSER_PROCS.has(process)) return 'browsing';
  if (sample.idleMs >= thresholds.idleMs) return 'idle';
  return 'unknown';
}

function reasonFor(kind: ActivityKind, process: string, title: string): string {
  const where = title ? `（${process || '未知程序'}：${title.slice(0, 60)}）` : process ? `（${process}）` : '';
  switch (kind) {
    case 'gaming': return `他正在打游戏${where}，绝对不要出声，安静看着就好。`;
    case 'meeting': return `他正在开会或通话${where}，不要说话。`;
    case 'away': return '他已经离开座位一段时间了，不要说话，等他回来。';
    case 'coding': return `他正在专心写代码${where}，不要打断，除非他先开口。`;
    case 'writing': return `他正在写东西${where}，不要打断。`;
    case 'watching': return `他正在看视频${where}，可以安静陪着，不要主动长篇说话。`;
    case 'music': return `他在听音乐${where}，氛围轻松，可以轻声搭话。`;
    case 'chatting': return `他在跟别人聊天${where}，你可以自然说话，但别抢话。`;
    case 'browsing': return `他在浏览网页${where}，比较放松，可以自然说话。`;
    case 'dsh-work': return '他正在和我一起干活，可以自然交流。';
    case 'idle': return '他闲下来了，这是最适合主动关心的时候。';
    default: return `看不准他在做什么${where}，先安静观察。`;
  }
}
