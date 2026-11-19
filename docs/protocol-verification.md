# 游戏接口的现场协议验证

验证日期：2026-10-17（中国标准时间）。本记录区分网络协议验证与真实账号的完整同步，避免把模拟测试或服务器连通误认为已经取得 真实航司数据。

## 已完成的最小现场验证

仅使用官方公开客户端中已有的 publishable API key。没有 Authorization 头、访问令牌、刷新令牌、账号 ID、航空公司 ID 或身份查询参数。

| 请求 | 中国标准时间 | 结果 |
| --- | --- | --- |
| `GET https://urmwaqnhesasfaeprcga-all.supabase.co/rest/v1/rpc/get_server_time` | 2026-10-17 12:43:34 | HTTP 200；`application/json; charset=utf-8`；返回 `2026-10-17T04:43:34.51775+00:00` |
| `OPTIONS https://urmwaqnhesasfaeprcga-all.supabase.co/rest/v1/rpc/get_master_player_by_master_uid` | 2026-10-17 12:44:25 | HTTP 200；空响应体；`Allow: GET, HEAD, POST, OPTIONS` |
| `OPTIONS https://urmwaqnhesasfaeprcga-all.supabase.co/rest/v1/rpc/get_player_by_uid` | 2026-10-17 12:44:26 | HTTP 200；空响应体；`Allow: GET, HEAD, POST, OPTIONS` |

主节点响应正常，因此没有请求备用节点。没有执行账号或航司 RPC，没有读取账户、机队、航班、航线或其他玩家数据。

此环境的默认沙箱首先阻止了网络套接字连接，未形成服务器响应；上述现场请求随后在批准的联网模式下完成。请求是一次服务器时钟读取和两次方法元数据检查，没有循环轮询。

## 能够证明的内容

- APK 中出现的主数据域名当前可达，接受客户端公开 API key。
- 服务器时钟读取 RPC 的 GET 路径和 JSON 响应真实可用。
- 两个账号映射 RPC 当前对外声明支持 GET。这里依据的是具体端点的 **Allow** 响应头，而不是网关通常宽泛的跨域允许方法列表。
- AOCC 可以采用固定域名、固定读取 RPC、固定参数及 GET 方法建立账号到自有航空公司的映射；仍需实际授权会话验证具体账户的返回结构与访问许可。

官方 PostgREST 文档说明，OPTIONS 不启动数据库事务；GET / HEAD 使用只读事务。不同版本的函数方法规则可能有差异，因此本记录保留了具体端点的现场方法声明。[事务与访问模式](https://docs.postgrest.org/en/latest/references/transactions.html)、[OPTIONS 方法](https://docs.postgrest.org/en/v13/references/api/options.html)、[函数 GET 调用](https://docs.postgrest.org/en/stable/references/api/functions.html)。

## 尚未完成的验证

**目前没有完成带真实账号的端到端同步。** 尚未登录用户游戏账号、导入用户会话、验证 实际航司的账户映射或读取其机队与周班表。

14 项离线适配器测试覆盖固定路径、认证续期、分页、区域回退、限流、子公司匹配和严格 UID 检查；11 项本地服务测试覆盖配对、跨站请求、凭据隔离和同步生命周期。这些测试验证实现行为，不能代替真实账户验证。

下一步由用户在官方涂装编辑器自行登录，通过本地扩展主动配对。成功后核对 AOCC 显示的航空公司、机队数量、航班数量、最后成功更新时间及班表推算说明。具体操作见 [连接指南](connection-guide.md)。

若真实接口返回方法、权限或结构错误，系统应保留已有成功快照并显示明确状态；不得为通过验证而扩大到未确认的游戏写入接口。
