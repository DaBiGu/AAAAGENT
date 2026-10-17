/**
 * 活动观察器：周期采样前台状态，归纳成「用户现在在做什么」，并在状态变化时通知。
 *
 * 隐私边界（有意为之）：
 *   * 原始窗口标题只在本机用于分类，**不进入发给模型的内容**
 *   * 对外只暴露活动类别、忙碌程度与空闲时长
 *   * 不截屏、不记录键盘、不注入进程、不落盘历史
 */
import { classifyActivity, DEFAULT_THRESHOLDS, labelFor, maySpeakFirst, type ActivityKind, type ActivityReading, type ClassifyThresholds } from './classify.js';
import { probeForeground, type ForegroundProbeOptions } from './foreground.js';

export interface ActivityObserverOptions {
  /** 采样间隔，默认 25 秒。 */
  readonly intervalMs?: number;
  readonly thresholds?: ClassifyThresholds;
  readonly probe?: ForegroundProbeOptions;
  /** 活动类别发生变化时回调；首次采样也会触发一次。 */
  readonly onChange?: (reading: ActivityReading, previous: ActivityReading | null) => void;
}

/** 连续失败多少次后把状态降级为 unknown（探测失败不应让桌宠以为用户在忙）。 */
const FAILURES_BEFORE_UNKNOWN = 3;

export class ActivityObserver {
  private timer: NodeJS.Timeout | undefined;
  private reading: ActivityReading | null = null;
  private failures = 0;
  private probing = false;

  constructor(private readonly options: ActivityObserverOptions = {}) {}

  get current(): ActivityReading | null { return this.reading; }

  start(): void {
    if (this.timer) return;
    const interval = Math.max(5000, this.options.intervalMs ?? 25_000);
    void this.sample();
    this.timer = setInterval(() => { void this.sample(); }, interval);
    // 观察器不能阻止桌宠进程退出。
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 采一次并更新状态。并发调用会被忽略，避免探测排队堆积。 */
  async sample(): Promise<ActivityReading | null> {
    if (this.probing) return this.reading;
    this.probing = true;
    try {
      const sample = await probeForeground(this.options.probe ?? {});
      if (!sample) {
        this.failures += 1;
        if (this.failures >= FAILURES_BEFORE_UNKNOWN) this.publish(unknownReading(this.reading));
        return this.reading;
      }
      this.failures = 0;
      this.publish(classifyActivity(sample, this.options.thresholds ?? DEFAULT_THRESHOLDS));
      return this.reading;
    } finally {
      this.probing = false;
    }
  }

  private publish(next: ActivityReading): void {
    const previous = this.reading;
    this.reading = next;
    if (previous && previous.kind === next.kind && previous.disturb === next.disturb) return;
    try { this.options.onChange?.(next, previous); } catch { /* 回调失败不影响采样循环 */ }
  }

  /** 用户现在在做什么（中文短语），拿不到时返回空串。 */
  get label(): string { return this.reading ? this.reading.label : ''; }

  get kind(): ActivityKind | null { return this.reading ? this.reading.kind : null; }

  /** 现在适合主动开口吗。拿不到状态时不主动。 */
  get maySpeakFirst(): boolean { return this.reading ? maySpeakFirst(this.reading.kind) : false; }

  /** 现在必须完全安静吗（打游戏、开会、离开座位）。 */
  get mustStaySilent(): boolean { return this.reading?.disturb === 'silent'; }

  /**
   * 供人格提示词使用的一句话。**刻意不含窗口标题**，避免把用户的文件名、
   * 网页标题等私人内容随对话请求发到模型服务。
   */
  describe(): string {
    const r = this.reading;
    if (!r) return '';
    if (r.kind === 'unknown') return '';
    const idleMinutes = Math.floor(r.idleMs / 60_000);
    const idle = idleMinutes >= 1 ? `，已经 ${idleMinutes} 分钟没有操作` : '';
    return `用户现在${r.label}${idle}。`;
  }
}

function unknownReading(from: ActivityReading | null): ActivityReading {
  return {
    kind: 'unknown',
    label: labelFor('unknown'),
    disturb: 'quiet',
    reason: '暂时读不到前台状态，先安静观察。',
    idleMs: from?.idleMs ?? 0,
    process: '',
    title: '',
    fullscreen: false,
    at: new Date().toISOString(),
  };
}
