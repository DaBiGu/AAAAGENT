import { COMPANION_LABEL, isProductCharacter } from '../contracts/character.ts';
import { installDisplayControls } from './display-controls.mjs';
import { DesktopChatLog } from './chat-log.ts';
import { DesktopViewState, DesktopConnectionState, scopeEquals } from './view-state.ts';
import { JellyfishRenderer } from './cubism-renderer.mjs';
import { BrowserPlaybackDriver } from '../media/browser-playback.ts';
import { DesktopPlaybackController } from './playback-controller.ts';
import { DESKTOP_BRIDGE_VERSION } from '../contracts/desktop-bridge.ts';
// Text-only companion: voice input, wake word, camera capture and work handoff
// are deliberately absent from this build. Speech remains output-only (TTS + lipsync).
const $ = id => document.getElementById(id);
const native = (name, value) => window.desktopHost ? window.desktopHost.postMessage(name, value) : window.webkit?.messageHandlers[name]?.postMessage(value);
const report = value => native('diagnostic', value);
const connection = new DesktopConnectionState();
const send = (value, generation = connection.generation) => {
  if (connection.current(generation) && connection.connected) native('desktop', { generation, message: value });
};
const view = new DesktopViewState();
// 主动关心：她说一句短话时走独立的视图状态，不占用对话轮次，也不污染聊天记录。
const careView = new DesktopViewState();
let careNotice = null, backendSessionId = null;
const spokenNotices = new Set();
const chat = new DesktopChatLog();
let companionRoute = null;
let textRequestId = null;
let composing = false;
let presentationPolicy = null;
let renderer;
let introduction = null, introductionEpoch = 0, introductionFramePending = false;
let panelOpen = false, panelEpoch = 0, panelAnimation, panelCloseTimer;
let lastUI = '';
let awaitingTextTurn = false;
let managementOpening = false;
const expandedInputs = new Set();
let lastInputRow = null, preserveReading = false;
function applyPresentationPolicy() {
  if (!renderer?.ready) return;
  const policy = presentationPolicy ?? { modelId: 'disconnected', revision: 0, enabledIds: [] };
  const applied = renderer.setAutomaticPolicy(policy);
  if (presentationPolicy) report({ type: 'presentation-policy', modelId: policy.modelId, revision: policy.revision, enabledCount: policy.enabledIds.length, applied: applied === true });
}
function managementResult(result) {
  if (!managementOpening || typeof result?.ok !== 'boolean') return;
  managementOpening = false; $('management').disabled = false; $('management').textContent = '控制台';
  $('management-notice').hidden = result.ok;
  $('management-notice').textContent = result.ok ? '' : '暂时无法打开控制台，请确认桌宠服务已启动后重试。';
}
$('management').onclick = () => {
  if (managementOpening) return;
  managementOpening = true; $('management').disabled = true; $('management').textContent = '打开中…';
  $('management-notice').hidden = true;
  native('shell', { type: 'open_management' });
};
const display = installDisplayControls({ get: $, shell: value => native('shell', value), setFraming: mode => renderer?.setFraming(mode) });
const reconnect = document.createElement('button'); reconnect.id = 'reconnect'; reconnect.type = 'button'; reconnect.textContent = '重新连接'; reconnect.hidden = true;
$('status').after(reconnect);
reconnect.onclick = () => { if (connection.canRetry && !connection.active) { reconnect.disabled = true; native('shell', { type: 'reconnect' }); } };
const connectionText = () => ({ connecting: '正在连接对话服务…', disconnected: '对话服务已断开', failed: connection.reason === 'version' ? '对话服务版本不一致，请退出后重新启动' : '对话服务连接失败' }[connection.state]);
report({ type: 'features', secureContext: isSecureContext, userAgent: navigator.userAgent, origin: location.origin });
function renderUI() {
  const uiKey = JSON.stringify([awaitingTextTurn, chat.revision, view.reply, view.error, view.state, view.characterId, view.invitation?.id, view.invitation?.text, connection.state, connection.reason, connection.canRetry, introduction?.id, introduction?.text]);
  if (uiKey === lastUI) return;
  lastUI = uiKey;
  const rows = chat.rows(view.characterId).map(row => {
    const item = document.createElement('div'); item.className = `chat-row ${row.kind}`; item.dataset.rowId = String(row.id);
    const label = document.createElement('span'); label.className = 'chat-label';
    label.textContent = row.kind === 'user' ? (row.status === 'sending' ? '你 · 发送中' : row.status === 'failed' ? '你 · 未送达' : '你') : COMPANION_LABEL;
    const text = document.createElement('div'); text.textContent = row.text;
    item.append(label, text);
    if (row.kind === 'user' && row.text.length > 140) {
      const expanded = expandedInputs.has(row.id);
      text.className = expanded ? 'input-original' : 'input-original input-original-preview';
      const more = document.createElement('button'); more.type = 'button'; more.className = 'input-full-toggle';
      more.textContent = expanded ? '收起全文' : '查看输入全文'; more.setAttribute('aria-expanded', String(expanded));
      more.onclick = () => { if (expanded) expandedInputs.delete(row.id); else expandedInputs.add(row.id); preserveReading = true; lastUI = ''; renderUI(); };
      item.append(more);
    }
    return item;
  });
  if (introduction) {
    const opening = document.createElement('section'); opening.id = 'introduction'; opening.className = 'introduction';
    const label = document.createElement('span'); label.className = 'introduction-label'; label.textContent = '开场 · 虚构设定';
    const text = document.createElement('div'); text.textContent = introduction.text; opening.append(label, text); rows.unshift(opening);
  }
  const log = $('reply'), scroller = $('conversation'), nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 36;
  const oldScroll = scroller.scrollTop, latestInput = chat.rows(view.characterId).filter(row => row.kind === 'user').at(-1)?.id;
  const showInput = latestInput !== lastInputRow; lastInputRow = latestInput;
  log.replaceChildren(...rows);
  const inputRow = showInput ? rows.find(row => row.dataset?.rowId === String(latestInput)) : null;
  if (preserveReading) { scroller.scrollTop = oldScroll; preserveReading = false; }
  else if (inputRow) scroller.scrollTop = Math.max(0, (scroller.scrollTop || 0) + inputRow.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
  else scroller.scrollTop = nearBottom ? scroller.scrollHeight : oldScroll;
  $('status').textContent = connectionText() || view.error || ({ idle: '我在这里', listening: '正在想怎么回应你…', thinking: '正在想怎么回应你…', speaking: '正在说话…', error: '这一轮没有完成' }[view.state]);
  $('thinking-indicator').hidden = !connection.connected || !!view.error || !(awaitingTextTurn || view.state === 'thinking');
  reconnect.hidden = connection.active || !connection.canRetry; reconnect.disabled = connection.active;
  $('invitation').disabled = !connection.connected;
  $('send').disabled = !connection.connected || chat.pending(view.characterId);
  $('invitation').hidden = !view.invitation; $('invitation').textContent = view.invitation?.text ?? '';
  if (panelOpen) fitComposer();
  scheduleIntroductionAck();
}
// This presentation is never appended to chat or submitted as user/model text.
function scheduleIntroductionAck() {
  const current = introduction, epoch = introductionEpoch;
  if (!current || current.acknowledged || introductionFramePending || !connection.connected || !panelOpen || document.hidden) return;
  const visible = () => {
    if (epoch !== introductionEpoch || introduction !== current || !connection.current(current.generation) || !connection.connected || !panelOpen || document.hidden) return false;
    const node = $('introduction');
    if (!node || !node.getClientRects().length || $('drawer').hidden) return false;
    const rect = node.getBoundingClientRect(), clip = $('conversation').getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right;
  };
  introductionFramePending = true;
  requestAnimationFrame(() => {
    if (!visible()) { if (epoch === introductionEpoch) introductionFramePending = false; return; }
    requestAnimationFrame(() => {
      if (epoch === introductionEpoch) introductionFramePending = false;
      if (!visible() || current.acknowledged) return;
      send({ channel: 'command', command: { type: 'acknowledge_introduction', introductionId: current.id } }, current.generation);
      current.acknowledged = true;
    });
  });
}
$('conversation').addEventListener('scroll', scheduleIntroductionAck);
function panel(open) {
  if (open && panelOpen && !$('drawer').hidden) { scheduleIntroductionAck(); return; }
  const epoch = ++panelEpoch;
  panelAnimation?.cancel(); panelAnimation = null;
  clearTimeout(panelCloseTimer);
  if (!open) document.activeElement?.blur?.();
  const drawer = $('drawer');
  panelOpen = open; drawer.inert = !open; $('open').hidden = open;
  $('open').setAttribute('aria-expanded', String(open));
  const animate = drawer.animate && !document.hidden && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const finishClose = () => { if (!panelOpen && epoch === panelEpoch && !drawer.hidden) { clearTimeout(panelCloseTimer); drawer.hidden = true; native('shell', { type: 'panel', open: false }); } };
  if (open) { drawer.hidden = false; native('shell', { type: 'panel', open: true }); }
  if (animate && !drawer.hidden) {
    panelAnimation = drawer.animate(open ? [{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}] : [{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(6px)'}], {duration:open ? 200 : 180,easing:'cubic-bezier(.2,.7,.2,1)'});
    // Occluded WKWebViews can suspend animation frames. Closing must still end.
    if (!open) panelCloseTimer = setTimeout(finishClose, 180);
    panelAnimation.finished.then(() => { if (!open) finishClose(); }, () => {});
  } else if (!open) finishClose();
  introductionEpoch++; introductionFramePending = false;
  if (open) { requestAnimationFrame(() => {
    if (panelOpen && epoch === panelEpoch && !document.hidden && document.hasFocus?.() !== false) { fitComposer(); $('text').focus({ preventScroll: true }); }
  }); scheduleIntroductionAck(); }
}
function fitComposer() {
  const input = $('text'); input.style.height = 'auto';
  input.style.height = `${Math.min(120, Math.max(24, input.scrollHeight || 24))}px`;
}
const playback = new DesktopPlaybackController(new BrowserPlaybackDriver(), scope => view.accepts(scope) || careView.accepts(scope), (requestId, event) => {
  const proactive = careView.accepts(event.scope);
  (proactive ? careView : view).receive({ type: 'playback', playback: event });
  if (proactive && event.type === 'started' && careNotice) careNotice.started = true;
  if (proactive && ['ended', 'stopped', 'error'].includes(event.type)) { careNotice = null; careView.reset(); }
  renderUI();
  send({ channel: 'playback', requestId, event });
  if (!proactive && ['ended', 'stopped', 'error'].includes(event.type)) renderer?.reset();
  if (event.type === 'started' || ['ended', 'stopped', 'error'].includes(event.type)) report({ type: 'playback-state', event: event.type, timingBasis: event.timingBasis, model: renderer?.ready ? renderer.snapshot() : null });
});
function stopPlayback(scope) { playback.stop(scope); }
/** 用户开始说话，或关心已被取消：立刻收回她没说完的那句。 */
function clearCareSpeech() { const scope = careNotice?.scope; careNotice = null; careView.reset(); if (scope) void stopPlayback(scope); }
function command(cmd) {
  if (!connection.connected) return;
  if (cmd.type === 'click_invitation' && !cmd.invitationId) return;
  if (cmd.type === 'submit_text') { textRequestId = crypto.randomUUID(); cmd = { ...cmd, clientRequestId: textRequestId }; }
  if (cmd.type === 'submit_text' && !chat.submit(view.characterId, cmd.text)) return;
  if (cmd.type === 'cancel') { chat.failPending(view.characterId); $('text').value = chat.draft(view.characterId); }
  if (['cancel', 'submit_text', 'click_invitation'].includes(cmd.type)) { clearCareSpeech(); companionRoute = null; void stopPlayback(); renderer?.reset(); }
  awaitingTextTurn = cmd.type === 'submit_text';
  view.command(cmd);
  renderUI(); send({ channel: 'command', command: cmd });
}
const bytesFromBase64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
function connectionChanged(value) {
  if (!connection.update(value)) return;
  awaitingTextTurn = false; companionRoute = null; textRequestId = null;
  clearCareSpeech(); spokenNotices.clear(); backendSessionId = null;
  presentationPolicy = null; applyPresentationPolicy();
  chat.cancelVoice(view.characterId);
  introduction = null; introductionEpoch++; introductionFramePending = false;
  chat.setDraft(view.characterId, $('text').value); chat.failPending(view.characterId); $('text').value = chat.draft(view.characterId);
  void stopPlayback(); renderer?.reset(); view.reset(); view.reply = ''; view.invitation = null;
  renderUI();
  if (!connection.active) panel(true);
}
function resetTurnState() {
  companionRoute = null; textRequestId = null;
  clearCareSpeech();
  awaitingTextTurn = false;
  introduction = null; introductionEpoch++; introductionFramePending = false;
  void stopPlayback(); renderer?.reset();
}
async function receive(message, generation) {
  if (!connection.current(generation)) return;
  if (message.channel === 'backend_ready') {
    if (message.bridgeVersion !== DESKTOP_BRIDGE_VERSION || !isProductCharacter(message.characterId) || typeof message.sessionId !== 'string' || !message.sessionId) {
      connectionChanged({ generation, state: 'failed', reason: 'version' });
      native('shell', { type: 'disconnect', generation }); return;
    }
    if (!connection.ready(generation)) return;
    resetTurnState();
    presentationPolicy = null; applyPresentationPolicy();
    backendSessionId = message.sessionId;
    view.setSession(message.characterId, message.sessionId);
    careView.setSession(message.characterId, message.sessionId);
    if (message.introduction && typeof message.introduction.id === 'string' && message.introduction.id && typeof message.introduction.text === 'string' && message.introduction.text.trim()) introduction = { ...message.introduction, generation, acknowledged: false };
    $('text').value = chat.draft(view.characterId); renderUI();
    report({ type: message.channel, characterId: message.characterId, bridgeVersion: DESKTOP_BRIDGE_VERSION }); return;
  }
  if (message.channel === 'backend_closed') { connectionChanged({ generation, state: 'disconnected' }); return; }
  if (!connection.connected) return;
  if (message.channel === 'presentation_policy') {
    const p = message.policy;
    if (!p || typeof p.modelId !== 'string' || !Number.isSafeInteger(p.revision) || p.revision < 0 || !Array.isArray(p.enabledIds) || p.enabledIds.some(id => typeof id !== 'string')) return;
    if (presentationPolicy?.modelId === p.modelId && p.revision <= presentationPolicy.revision) return;
    presentationPolicy = structuredClone(p); applyPresentationPolicy(); return;
  }
  // 主动关心：她主动开口说一句短话。不属于任何对话轮次，只在空闲时播出。
  if (message.channel === 'work_speech') {
    const e = message.event;
    if (!e || !e.scope || e.scope.sessionId !== backendSessionId || !isProductCharacter(e.scope.characterId) || typeof e.noticeId !== 'string') return;
    if (e.state === 'end') {
      if (careNotice?.noticeId === e.noticeId && scopeEquals(careNotice.scope, e.scope)) {
        if (playback.busy && scopeEquals(playback.scope, e.scope)) careNotice.ending = true; else clearCareSpeech();
      }
      return;
    }
    if (e.state !== 'start' || spokenNotices.has(e.noticeId) || awaitingTextTurn || ['thinking', 'speaking'].includes(view.state)) return;
    clearCareSpeech();
    spokenNotices.add(e.noticeId);
    careNotice = { noticeId: e.noticeId, scope: e.scope, started: false, ending: false };
    careView.scope = e.scope;
    renderUI();
    return;
  }
  if (message.channel === 'input_route') {
    if (!view.accepts(message.scope)) return;
    // Work handoff is not part of this build; every routed turn stays on the companion route.
    chat.route(message.scope, 'companion');
    companionRoute = message.scope;
    renderUI(); return;
  }
  if (message.channel === 'event') {
    const e = message.event;
    if (e.type === 'turn' && e.input.kind === 'text' && (!textRequestId || e.input.clientRequestId !== textRequestId)) return;
    if (e.type === 'reply' && !scopeEquals(companionRoute, e.reply.scope)) return;
    const accepted = view.receive(e);
    if (accepted && e.type === 'turn') { chat.acknowledge(e.input.scope, true); }
    if (accepted && e.type === 'reply') chat.reply(e.reply.scope, e.reply.text);
    if (accepted && ['turn', 'error'].includes(e.type)) awaitingTextTurn = false;
    if (accepted && e.type === 'error') { chat.failPending(view.characterId); $('text').value = chat.draft(view.characterId); }
    if (accepted && (e.type === 'error' || e.type === 'presentation' && e.presentation.state === 'error')) { void stopPlayback(); renderer?.reset(); }
    if (accepted && e.type === 'turn') { if (playback.scope && !scopeEquals(playback.scope, e.input.scope)) void stopPlayback(); renderer?.reset(); }
    if (accepted) renderUI(); return;
  }
  try {
    if (message.channel === 'stop') {
      await stopPlayback(message.scope);
      send({ channel: 'ack', requestId: message.requestId }, generation); return;
    }
    if (message.channel === 'play') {
      const proactive = careNotice && !careNotice.ending && scopeEquals(careNotice.scope, message.tts.scope);
      if ((!scopeEquals(companionRoute, message.tts.scope) && !proactive) || (proactive && careNotice.playRequestId && careNotice.playRequestId !== message.requestId)) {
        message.audioBase64 = ''; send({ channel: 'playback', requestId: message.requestId, event: { type: 'stopped', scope: message.tts.scope, at: new Date().toISOString() } }); return;
      }
      if (proactive) careNotice.playRequestId = message.requestId;
      const bytes = bytesFromBase64(message.audioBase64); message.audioBase64 = '';
      await playback.play(message.requestId, message.tts, bytes);
      return;
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : '播放失败';
    const scope = message.scope ?? message.tts?.scope;
    if (connection.current(generation) && scope && view.accepts(scope)) { view.receive({ type: 'error', scope, message: text }); renderUI(); }
    send({ channel: 'rpc_error', requestId: message.requestId, ...(scope ? { scope } : {}), message: text }, generation);
  }
}
window.petBridge = { receive, connectionChanged, displayConfig: display.receive, managementResult };
window.desktopHost?.subscribe((method, ...args) => window.petBridge[method]?.(...args));
$('open').onclick = () => panel(true); $('close').onclick = () => panel(false);
$('quit').onclick = () => { void stopPlayback(); native('shell', { type: 'quit' }); };
$('text').oninput = () => { chat.setDraft(view.characterId, $('text').value); fitComposer(); };
$('text').oncompositionstart = () => { composing = true; };
$('text').oncompositionend = () => { composing = false; };
$('text').onkeydown = event => {
  if (event.key !== 'Enter') return;
  if (composing || event.isComposing || event.keyCode === 229) { event.preventDefault(); return; }
  if (!event.shiftKey) { event.preventDefault(); $('form').requestSubmit(); }
};
$('form').onsubmit = event => {
  event.preventDefault(); const text = $('text').value.trim();
  if (composing || event.isComposing || !text || !connection.connected || chat.pending(view.characterId)) return;
  $('text').value = ''; command({ type: 'submit_text', text });
};
$('text').onfocus = () => report({ type: 'input-focus', active: document.activeElement === $('text') });
$('invitation').onclick = () => { if (view.invitation) { const id = view.invitation.id; view.invitation = null; panel(true); command({ type: 'click_invitation', invitationId: id }); } };
let pointer;
$('character').onpointerdown = e => { pointer = { x: e.screenX, y: e.screenY, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); };
$('character').onpointermove = e => { if (!pointer) return; const dx = e.screenX - pointer.x, dy = e.screenY - pointer.y; if (Math.abs(dx) + Math.abs(dy) > 3 || pointer.moved) { pointer.moved = true; native('shell', { type: 'drag', dx, dy }); pointer.x = e.screenX; pointer.y = e.screenY; } };
$('character').onpointercancel = $('character').onlostpointercapture = () => { pointer = null; };
$('character').onpointerup = () => { if (pointer && !pointer.moved) panel(!panelOpen); pointer = null; };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && display.cancel(e)) return;
  if (composing || e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Escape') { if (playback.busy || view.scope) command({ type: 'cancel' }); else panel(false); }
}, true);
window.addEventListener('blur', () => { display.cancel(); pointer = null; });
document.addEventListener('visibilitychange', () => { introductionEpoch++; introductionFramePending = false; if (document.hidden) { display.cancel(); pointer = null; } else scheduleIntroductionAck(); });
window.addEventListener('pagehide', () => { display.cancel(); connectionChanged({ generation: connection.generation, state: 'disconnected' }); void stopPlayback(); renderer?.dispose(); });
window.addEventListener('error', e => report({ type: 'script-error', message: e.message }));
window.addEventListener('unhandledrejection', e => report({ type: 'promise-error', message: String(e.reason) }));
renderUI(); native('shell', { type: 'ready' });
let frame = 0, lastRender = 0;
try {
  renderer = new JellyfishRenderer($('model'), report); await renderer.load(); applyPresentationPolicy(); renderer.setFraming(display.mode); $('loading').hidden = true;
  function animate(at) { requestAnimationFrame(animate); if (at - lastRender > 32) { if (view.expireInvitation(Date.now())) renderUI(); const shown = careView.state === 'speaking' ? careView : view; renderer.updateView(shown, shown.state); lastRender = at; frame++; } }
  requestAnimationFrame(animate);
  // Bounded telemetry of model parameters only, never transcript/audio/frame contents.
  let lastTrace = 0;
  setInterval(() => { if (playback.busy && performance.now() - lastTrace > 700) { lastTrace = performance.now(); report({ type: 'speaking-parameters', ...renderer.snapshot() }); } }, 500);
} catch (error) { $('loading').textContent = '模型加载失败'; view.error = error.message; report({ type: 'model-error', message: error.message, stack: error.stack }); panel(true); renderUI(); }
