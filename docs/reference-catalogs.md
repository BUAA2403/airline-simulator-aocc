# 机场区域与机型资料维护

区域判断统一由 `web/regions.mjs` 提供，网页筛选、周班表、打印和导出沿用同一结果。数据直接依据同步快照中的机场资料重新计算，新增航线无需另建区域清单。

- 全球目录采用联合国统计司 M49 的 248 个国家及地区条目。识别英文、中文、ISO 两位和三位代码，以及游戏使用的旧称、简称。港澳台、国内、伊朗等按本系统的航线经营分区处理；中亚单列，拉丁美洲包含加勒比地区。
- 俄罗斯使用 Natural Earth 1:50m 一级行政区多边形。远东地区归东北亚，乌拉尔及西伯利亚归北亚，其余归欧洲；布里亚特、外贝加尔按 2018 年后的远东区划处理。沿海机场可在一度以内就近匹配边界。它是运行分区约定，并非直接照搬 M49 的俄罗斯整国欧洲分组。
- 荷属加勒比机场按机场位置归拉丁美洲。未知国家不再用大矩形猜测，保留“其他”并在同步日志列出机场代码。

机型外形资料在 `web/aircraft-catalog.mjs` 统一管理，与游戏的座椅产品类别、地图图标类别分开。实际机长、翼展及舱宽读取 APK 的机型目录。准确型号优先，ICAO 无歧义时匹配具体型号，新衍生型号可识别机型系列；没有准确资料时不套用其他型号尺寸或图片。

- 747、A340、A380 为四发；717、CRJ、ERJ 135/140/145、ARJ21 为尾置双发；ATR、Dash 8 使用涡桨外形。747 标为局部双层、A380 为全长双层。
- 客舱平面图复用 [Jets Seatmap](https://github.com/Kwiket/jets-seatmap-react-lib-pub/tree/version-3) 的 Apache-2.0 矢量机头及座椅模板。31 种机头模板覆盖当前机型系列，界面配色、座位位置及实时数据绑定由本系统适配。只保留允许的静态 SVG 图形，没有引入它的第三方航班服务。许可证及改动声明见 `public/licenses/jets-seatmap/`，离线重建用 `python tools/build-cabin-templates.py`。
- 不再在客舱界面显示白色机型侧视图。早前提取的 65 张原生素材保留作研究参考，不代表 当前航司的涂装。
- 客舱座位按真实配置、座位数计算，保留最后一排不足额的情况。游戏未提供分层分配时，不虚构上下层座位分配。座位图是配置示意，并非带有具体应急出口及厨房位置的适航图纸。
- 宽体不同舱等共用真实机身宽度，按各自的横排组合放大座椅与间距，避免头等、公务座椅缩在经济舱宽度中央。可切换全舱或单舱段，并在 100%–300% 放大查看。
- 未知机型不默认画两台发动机；已知系列的新型号可使用系列特征，但缺失的尺寸、图片会留空。

每次成功同步会检查区域与机型目录缺项，仅在缺项变化时写入同步日志，不影响正常数据更新。`tests/reference-catalogs.test.mjs` 检查游戏当前全部 2,232 个机场、78 个机型、原生素材是否完整，以及俄罗斯边界、日期变更线、海外属地和座位数量等情况。更新 APK 静态目录后执行完整测试，新增目录项漏配会明确报出。

重建命令：

```
python tools/build-geography.py
python tools/extract-aircraft-profiles.py
npm run check
```

前一个命令需要 Python BeautifulSoup；从 `research/reference` 的离线快照重建。后一个命令仅解出机型侧视图，不读取登录会话。

参考资料：

- [UNSD M49](https://unstats.un.org/unsd/methodology/m49/)
- [Natural Earth 行政区源数据（公有领域）](https://github.com/nvkelso/natural-earth-vector/tree/master/geojson)
- [Boeing 机场规划手册](https://www.boeing.com/commercial/airports/plan-manuals)
- [Airbus A380](https://www.airbus.com/en/products-services/commercial-aircraft/passenger-aircraft/a380)
