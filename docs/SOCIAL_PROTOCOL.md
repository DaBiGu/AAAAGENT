# 角色社交协议 v1

[中文使用说明](SOCIAL_MEMORY.md) · [English](#english)

每个实例只管理一个稳定 `roleId`。本地产品角色 `companion` 通过连接配置映射到此实例，不把所有用户的桌宠合并为同一身份。云端数据目录 `social.sqlite` 与本地 `social-cache.sqlite` 独立。

请求前缀为 `/v1/{roleId}/`。角色 ID、参与者、群标识和原始事件 ID 都是明确字段。消息重试必须使用相同事件 ID 与相同正文；同 ID 异正文返回409。平台昵称仅用于显示。

| 方法与路径 | 凭据 | 用途 |
|---|---|---|
| GET /health | 无 | 存活检查，不返回角色资料 |
| POST events | channel | 接收群消息 |
| POST deliveries/claim | channel | 领取一个待发回复及租约 |
| POST deliveries/ack | channel | 提交真实发送回执 |
| POST deliveries/fail | channel | 上报明确未发出或结果未知 |
| GET sync?after=N | sync | 角色公开设定、获准共享的经历及撤回事件 |
| GET status / GET jobs | admin | 状态与异常记录，无消息正文 |
| PUT group / PUT persona | admin | 版本比较更新 |
| DELETE experiences/{id} | admin | 遗忘原文及经历，产生撤回事件 |
| POST jobs/resolve | admin | 管理员处理明确的未知/失败事件 |

三类 Bearer 凭据相互独立。同步凭据没有写入权限；渠道凭据不能改人设、群权限或读取桌宠同步数据。跨角色路径不可用，浏览器 Origin 请求被社交接口拒绝。生产环境在 HTTPS 后使用；无鉴权的演示首页仅限回环地址且使用同源会话。

群事件字段：`eventId, roleId, scope:"group", groupId, actorId, actorName, text, occurredAt, addressed`。额外字段拒绝，尤其不接收私聊历史或任意工具请求。群必须由管理员预先启用。

发送适配器使用稳定 `deliveryId` 做平台侧去重。只有目标平台确认送达才调用 ack，字段为 `deliveryId, lease, receipt`。领取回复不等于发送成功。明确未发送使用 fail 的 `outcome:"not_sent"`；无法判断是否已发送使用 `"unknown"`。服务重启会将未完成的模型请求和正在发送的回复标记为未知。自动重发不能替代真实回执核查。

回复领取后若人设或群策略版本改变，后续真实发送回执仍保存为 delivered，避免再次发送；旧摘要不生成可共享经历，事件记录 `configuration_changed_after_claim`。重新开启群共享也不会恢复这条旧摘要。

经历字段：角色、群、参与者、摘要、原消息与发送回执 ID、发生时间、`perspective:"participated"`。只有确认送达后才生成参与经历；仅旁听的消息留在群记录中。云端下次回复只读取同群历史及同群同参与者的既有经历，保留群内关系归属。

sync 携带 `epoch`（数据库身份）、单调游标、当前人设版本、允许共享的群列表、经历增量与删除标记。客户端逐页原子提交游标与缓存；权限撤回即使没有新经历也生效。重新允许共享时会重新发布该群现有经历。云端数据库身份改变或游标倒退会报错，不能把新库默认为旧库。每条摘要保存实际输入的直接来源依赖；遗忘会沿依赖关系撤回后续派生摘要、停止相关未完成回复，并发布删除事件，避免从后续摘要中重新取回已遗忘内容。

本地缓存只通过 GET 拉取；没有私人对话上传接口。私人对话仍走原桌宠模型，云端社交服务无法读取该数据库。对话请求将共享社交经历作为单独、带来源的参考，参与真实请求预算，且在模型返回后校验缓存版本。记忆遗忘或不明确请求期间不注入社交内容。

基础人设由管理员维护并通过 CAS 更新。群聊内容、模型返回的摘要及昵称不能赋予权限或直接修改人格。当前不自动把社交反馈训练为人格变化，也没有桌面工具远程执行能力。

模型输入和输出只在角色社交范围内，模型无文件或终端工具。摘要生成的语义准确性需要真实模型评估；本地检查只证明来源、权限、归属和流程。未知计费状态不自动重试。人设、授权范围或遗忘发生变更时，进行中的旧响应不得继续作为新经历发布。

## English

Each service owns one stable `roleId`. The desktop maps its `companion` identity to that role. Public persona, group data and the local summary cache have separate storage.

Requests use `/v1/{roleId}/` except `GET /health`. Bearer credentials have distinct roles:

| Route | Credential | Purpose |
| --- | --- | --- |
| `POST events` | channel | Ingest an enabled group's event |
| `POST deliveries/claim` | channel | Claim one prepared reply and its lease |
| `POST deliveries/ack` | channel | Confirm an actual delivery receipt |
| `POST deliveries/fail` | channel | Report `not_sent` or `unknown` |
| `GET sync?after=N` | sync | Public persona, permitted experiences and retractions |
| `GET status`, `GET jobs` | admin | Inspect state and failed/unknown jobs |
| `PUT group`, `PUT persona` | admin | Compare-and-swap settings with `expectedRevision` |
| `DELETE experiences/{id}` | admin | Forget sourced social data and derived summaries |
| `POST jobs/resolve` | admin | Reconcile an unknown or failed event |

A group event has `eventId`, `roleId`, `scope:"group"`, `groupId`, `actorId`, `actorName`, `text`, `occurredAt` and `addressed`. Reject extra fields. Retries keep both the event ID and payload unchanged; conflicting content returns 409. Nicknames never substitute for stable identities.

A sender deduplicates by `deliveryId`, sends to the platform, and only then ACKs `deliveryId`, `lease` and the actual `receipt`. Claiming is not delivery. Explicit failures use `outcome:"not_sent"`; ambiguous outcomes use `"unknown"` and wait for reconciliation. Restart marks unfinished model requests and claimed deliveries unknown. If persona or policy changes after a claim, the receipt is retained as delivered, but no stale summary is published.

Only confirmed participation produces an experience with role, group, participants, source event IDs, timestamp and `perspective:"participated"`. Same-group history and same-participant experiences inform subsequent social replies.

Sync carries the database `epoch`, a monotonic cursor, persona version, allowed groups and upsert/delete changes. Clients atomically commit pages and cursors, remove revoked groups even without new messages, and reject changed database identity or decreasing cursors. Forgetting follows source dependencies to retract derived experiences and cancel affected pending replies.

The local client uses GET requests and does not upload private conversations. Social references count toward the complete dialogue request budget. Cached references are checked before and after inference; forgetting requests exclude them. Existing private memory has its own correction/forgetting controls.

Use HTTPS for remote connections. The service rejects browser-Origin requests; the synthetic demo has a separate loopback UI and same-origin session. Model calls have no file or terminal tools. Public persona changes use administrator credentials, not group messages.
