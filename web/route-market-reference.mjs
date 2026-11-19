export const airportTrafficSource = {
  label:'中国民航局 · 2025 年枢纽机场旅客吞吐量',
  url:'https://www.caac.gov.cn/PHONE/XXGK_17/XXGK/TJSJ/202602/t20260226_230119.html',
};

// Annual passenger totals for the destination airport, including every market.
export const airportTraffic = {
  PVG:84994548, CAN:83582952, PEK:70742712, SZX:66485213, TFU:56686738, PKX:53618949,
  HGH:50459018, SHA:50151025, CKG:50094770, KMG:49705725, XIY:48535594, CTU:33518945,
  NKG:31378166, WUH:31339277, CSX:30253675, XMN:29193712, CGO:29191990, URC:29179737,
  TAO:26896534, HAK:26851102, SHE:24938062, HRB:24650717, KWE:22731681, SYX:22685734,
  TNA:20329972, TSN:19862196, DLC:19787716, CGQ:17759299, LHW:17734885, NGB:16125459,
  FOC:16117180, TYN:14573546, NNG:13502293, WNZ:13058523, HET:12722692, HFE:12644989,
  SJW:12014301, KHN:11936032, INC:9860514, XNN:7877903, KWL:6504366, LXA:6284823,
};

export const routeReferences = new Map();
function addRoutes(origin, destinations, note, label, url) {
  for (const destination of destinations.split(' ')) {
    routeReferences.set([origin,destination].sort().join('|'),{note,label,url});
  }
}

const winterShanghai = 'https://www.gzw.sh.gov.cn/shgzw_zxzx_gqdt/20261028/4e979e0646dc4e17a7e758e8f377633b.html';
const shanghaiAirport = 'https://www.shanghaiairport.com/xwg/info_itemid_44366.html';
addRoutes('PVG','FRA AKL SYD SIN BKK CJU SGN','2026/27 冬春航季计划加密','上海市国资委 · 航季计划',winterShanghai);
addRoutes('PVG','ALG','2026/27 冬春航季计划新增','上海市国资委 · 航季计划',winterShanghai);
addRoutes('PVG','CCU','2026 夏秋航季计划新增','上海机场集团 · 航季计划',shanghaiAirport);
addRoutes('PVG','IST KUL HAN ALA','2026 夏秋航季计划加密','上海机场集团 · 航季计划',shanghaiAirport);
addRoutes('PVG','ADL BOM DUB MDC SUB MCT','2026 夏秋航季公布新航线','上海机场集团 · 航季计划',shanghaiAirport);
addRoutes('PVG','PQC TAS ZRH TBS','2026 年公布开通','上海市口岸办 · 枢纽通达性',
  'https://kab.sww.sh.gov.cn/xwzx/001001/20260804/a9ea6927-4da6-47c9-9a58-3ecd6167c22c.html');
addRoutes('PVG','CJJ KJA MRS ARN','2026 年公布开通、恢复或加密','上海市口岸办 · 新增运力',
  'https://kab.sww.sh.gov.cn/xwzx/001001/20260702/051e74a1-c1fa-4dcd-933d-7cf8b11ac80e.html');

addRoutes('PEK','BRU UYN JNH','中国国航 2026 年公布开通','中国国航 · 2026 年 3 月运营数据',
  'https://static.cninfo.com.cn/finalpage/2026-04-16/1225105516.PDF');
addRoutes('PEK','HZG DEL','中国国航 2026 年公布开通或恢复','中国国航 · 2026 年 4 月运营数据',
  'https://static.cninfo.com.cn/finalpage/2026-05-16/1225309545.PDF');
addRoutes('PEK','VCE','中国国航 2026 年公布开通','中国国航 · 2026 年 7 月运营数据',
  'https://static.cninfo.com.cn/finalpage/2026-08-14/1225475935.PDF');
addRoutes('PEK','OTP','国航北京至萨格勒布航线首段','北京市外办 · 国航开航公告',
  'https://wb.beijing.gov.cn/home/yhcs/sjyhcs/zxdt/202608/t20260821_4831712.html');
addRoutes('PEK','CPH','国航北京至雷克雅未克航线首段','首都机场集团 · 2026/27 冬春航季',
  'https://www.cah.com.cn/content/2026/10-28/7521004432373321728.html');
