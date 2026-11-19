# 代码共享

在运行控制、地图、航线网络和周班表上方切换「全部航班／仅自营／仅共享」，选择会保存在本机浏览器。仅共享显示由合作航司承运、当前航司挂号的航班；自营包括我方承运并向他航开放挂号的航班。

「共享合作」展开协议表，可查看双方角色、合作航司、共享号、周班次、机型及本航司的周计划收益，并打开最近执行任务。航班详情保留我方共享号、实际执飞号、承运人、机号、客舱和各视角。共享地图航班采用蓝色，随同一游戏时钟推进。

每周航班计划按「自营航班」「共享航班」分别发布，各分区内仍按基地、区域、目的地及往返编排。表首可直接跳转到相应分区；同号同时刻也不会跨分区合并。下载的 HTML 和打印保留两个独立表格，CSV 增加「承运类别」列。全局「仅自营／仅共享」筛选继续生效。

共享资料与原有 60 秒同步同时更新，协议删除后相应合作任务移除。读取不可用时明确提示，不将错误当作零合作。仅按当前已确认协议获取关联计划及所分配飞机，不枚举合作航司机队。所有游戏业务请求均为 GET；不会申请、修改或终止协议。

合作飞机不计入自有机队，也不参与本航司排班冲突告警。伙伴飞机仅展示已接入的共享任务，不代表其完整利用率。承运航班的旅客、运力为全航班计划值，不是 本航司的销售份额。共享收益按协议独立列示，承运航班原有全额利润不会被并入自营利润。单文件 AI 分析包增加独立 codeshares 数据区和对应口径。

## 客户端证据（随附 APK 1.30.6）

- 41957：`codeshare_flight_data.select('*').eq('operatingUid', uid)` 与 `.eq('marketingUid', uid)`。
- 19376：协议字段 `codeshareId, operatingFlightId, operatingUid, marketingUid, marketingOutboundFlightNumber, marketingInboundFlightNumber, originAirport, destinationAirport, operatingCarrierProfit, marketingCarrierProfit`。
- 42818、41587：按 flightId / aircraftId 列表读取 `new_player_flight_data`、`player_aircraft_data`；AOCC 额外要求所属承运 UID 匹配。
- 43836：营销共享方读取协议指向的原生计划、经停子计划、已分配飞机。地图使用承运计划，挂营销航班号；同一物理执行只显示一次。
- 27943：共享收益按原生 `getTotalFlightProfit` 的 K 单位计算，因此转换为 USD 时乘 1000，不再乘运营日或往返次数。
