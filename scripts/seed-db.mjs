import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (d) => { const dt = new Date(Date.now() - d * 86400000); return dt.toISOString().slice(0, 19).replace("T", " "); };

async function seed() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log("🌱 بدء إدخال البيانات التجريبية...\n");

  // 1. SITES
  const sitesData = [
    ["برج الأعمال المركزي", "شارع الملك فهد، الرياض", "مبنى إداري 20 طابق"],
    ["مجمع الواحة السكني", "حي النزهة، جدة", "مجمع سكني 150 وحدة"],
    ["مركز النخيل التجاري", "طريق الأمير سلطان، الدمام", "مركز تجاري 3 طوابق"],
    ["فندق القصر الذهبي", "حي العليا، الرياض", "فندق 5 نجوم - 200 غرفة"],
    ["مستودعات الصناعية", "المنطقة الصناعية الثانية، الرياض", "5 مستودعات كبيرة"],
    ["مبنى الشركة الرئيسي", "حي الملقا، الرياض", "المقر الرئيسي للشركة"],
    ["مجمع الحدائق", "حي الروضة، جدة", "مجمع فلل 30 وحدة"],
    ["مركز الرعاية الطبية", "شارع التحلية، جدة", "عيادات طبية متعددة"],
    ["مبنى المكاتب الذكية", "حي الياسمين، الرياض", "مبنى مكاتب حديث"],
    ["المجمع الترفيهي", "طريق الملك عبدالله، الرياض", "مرافق ترفيهية ورياضية"],
  ];
  console.log("📍 إدخال المواقع...");
  for (const s of sitesData) {
    await conn.execute("INSERT INTO sites (name, address, description, isActive) VALUES (?, ?, ?, true)", s);
  }
  console.log(`   ✅ ${sitesData.length} مواقع\n`);

  // 2. USERS
  const usersData = [
    ["seed-op-1", "أحمد الغامدي", "ahmed.g@company.sa", "0501234567", "operator", "التشغيل"],
    ["seed-op-2", "سعد العتيبي", "saad.o@company.sa", "0502345678", "operator", "التشغيل"],
    ["seed-op-3", "فهد القحطاني", "fahad.q@company.sa", "0503456789", "operator", "التشغيل"],
    ["seed-tech-1", "حسن المالكي", "hassan.m@company.sa", "0504567890", "technician", "الصيانة"],
    ["seed-tech-2", "عبدالله الشهري", "abdullah.s@company.sa", "0505678901", "technician", "الصيانة"],
    ["seed-tech-3", "محمد الدوسري", "mohammed.d@company.sa", "0506789012", "technician", "الصيانة"],
    ["seed-tech-4", "يوسف الحربي", "yousef.h@company.sa", "0507890123", "technician", "الصيانة"],
    ["seed-mm-1", "خالد الزهراني", "khalid.z@company.sa", "0508901234", "maintenance_manager", "إدارة الصيانة"],
    ["seed-pm-1", "ماجد السبيعي", "majed.s@company.sa", "0509012345", "purchase_manager", "المشتريات"],
    ["seed-del-1", "ناصر العنزي", "nasser.a@company.sa", "0510123456", "delegate", "المشتريات"],
    ["seed-del-2", "بندر الشمري", "bandar.sh@company.sa", "0511234567", "delegate", "المشتريات"],
    ["seed-del-3", "تركي المطيري", "turki.m@company.sa", "0512345678", "delegate", "المشتريات"],
    ["seed-acc-1", "عمر الحارثي", "omar.h@company.sa", "0513456789", "accountant", "الحسابات"],
    ["seed-acc-2", "سلطان البقمي", "sultan.b@company.sa", "0514567890", "accountant", "الحسابات"],
    ["seed-sm-1", "عبدالرحمن الراشد", "abdulrahman.r@company.sa", "0515678901", "senior_management", "الإدارة العليا"],
    ["seed-sm-2", "فيصل النعيمي", "faisal.n@company.sa", "0516789012", "senior_management", "الإدارة العليا"],
    ["seed-wh-1", "سامي الجهني", "sami.j@company.sa", "0517890123", "warehouse", "المستودع"],
    ["seed-wh-2", "رائد العمري", "raed.o@company.sa", "0518901234", "warehouse", "المستودع"],
    ["seed-own-1", "السيد مالك الشركة", "owner@company.sa", "0519012345", "owner", "الملاك"],
    ["seed-own-2", "السيد نائب المالك", "vp@company.sa", "0520123456", "owner", "الملاك"],
  ];
  console.log("👥 إدخال المستخدمين...");
  for (const u of usersData) {
    await conn.execute("INSERT INTO users (openId, name, email, phone, role, department, isActive, lastSignedIn) VALUES (?, ?, ?, ?, ?, ?, true, NOW())", u);
  }
  console.log(`   ✅ ${usersData.length} مستخدم\n`);

  // Get user IDs by role
  const [userRows] = await conn.execute("SELECT id, role, name FROM users WHERE openId LIKE 'seed-%'");
  const byRole = {};
  for (const r of userRows) { if (!byRole[r.role]) byRole[r.role] = []; byRole[r.role].push(r); }
  const ops = byRole.operator || [];
  const techs = byRole.technician || [];
  const mm = byRole.maintenance_manager || [];
  const dels = byRole.delegate || [];
  const accs = byRole.accountant || [];
  const sm = byRole.senior_management || [];
  const wh = byRole.warehouse || [];
  const own = byRole.owner || [];
  const allUsers = userRows;

  // 3. TICKETS
  const tData = [
    ["تسريب مياه في الحمام الرئيسي", "plumbing", "high"],
    ["عطل في نظام التكييف المركزي", "hvac", "critical"],
    ["انقطاع كهرباء في الطابق الثالث", "electrical", "critical"],
    ["تشقق في جدار المدخل الرئيسي", "structural", "medium"],
    ["صوت غريب في المصعد رقم 2", "mechanical", "high"],
    ["إضاءة معطلة في موقف السيارات", "electrical", "medium"],
    ["انسداد في مجرى الصرف الصحي", "plumbing", "high"],
    ["تلف في لوحة التحكم الكهربائية", "electrical", "critical"],
    ["تسريب غاز في المطبخ المركزي", "safety", "critical"],
    ["عطل في مضخة المياه الرئيسية", "plumbing", "high"],
    ["كسر في زجاج النافذة - الطابق 5", "structural", "medium"],
    ["عطل في نظام إنذار الحريق", "safety", "critical"],
    ["تلف في أرضية الردهة الرئيسية", "structural", "low"],
    ["عطل في مكيف الغرفة 305", "hvac", "medium"],
    ["تسريب في سقف الطابق الأخير", "plumbing", "high"],
    ["عطل في باب الطوارئ الخلفي", "safety", "high"],
    ["مشكلة في نظام الري التلقائي", "mechanical", "low"],
    ["تلف في وحدة التبريد - المستودع", "hvac", "high"],
    ["عطل في كاميرا المراقبة - البوابة", "electrical", "medium"],
    ["انسداد في مصرف المياه - الطابق 2", "plumbing", "medium"],
    ["تشقق في أنبوب المياه الساخنة", "plumbing", "high"],
    ["عطل في مولد الكهرباء الاحتياطي", "electrical", "critical"],
    ["تلف في نظام التهوية - القبو", "hvac", "medium"],
    ["مشكلة في قفل الباب الرئيسي", "mechanical", "medium"],
    ["تنظيف عميق للخزان الأرضي", "cleaning", "low"],
    ["صيانة دورية للمصاعد", "mechanical", "medium"],
    ["إصلاح سور المبنى الخارجي", "structural", "low"],
    ["عطل في نظام الإنتركم", "electrical", "medium"],
    ["تسريب زيت في مولد الكهرباء", "mechanical", "high"],
    ["تلف في مفتاح التكييف - الاستقبال", "hvac", "low"],
    ["عطل في مضخة الصرف الصحي", "plumbing", "high"],
    ["مشكلة في الإضاءة الخارجية", "electrical", "low"],
    ["تلف في عداد الكهرباء الفرعي", "electrical", "medium"],
    ["صيانة نظام الطاقة الشمسية", "electrical", "low"],
    ["عطل في صمام المياه الرئيسي", "plumbing", "critical"],
  ];

  const statusDist = [
    "new","new","new","approved","approved",
    "assigned","assigned","assigned","in_progress","in_progress",
    "in_progress","in_progress","needs_purchase","needs_purchase","purchase_pending_estimate",
    "purchase_pending_accounting","purchase_pending_management","purchase_approved","partial_purchase","purchased",
    "purchased","received_warehouse","repaired","repaired","repaired",
    "verified","verified","closed","closed","closed",
    "closed","closed","closed","closed","closed",
  ];

  const allStatuses = ["new","approved","assigned","in_progress","needs_purchase","purchase_pending_estimate","purchase_pending_accounting","purchase_pending_management","purchase_approved","partial_purchase","purchased","received_warehouse","repaired","verified","closed"];
  const needsAssign = new Set(["assigned","in_progress","needs_purchase","purchase_pending_estimate","purchase_pending_accounting","purchase_pending_management","purchase_approved","partial_purchase","purchased","received_warehouse","repaired","verified","closed"]);
  const year = new Date().getFullYear();

  console.log("🎫 إدخال البلاغات...");
  for (let i = 0; i < tData.length; i++) {
    const [title, cat, pri] = tData[i];
    const status = statusDist[i];
    const siteId = randInt(1, 10);
    const reporter = pick(ops);
    const assignee = needsAssign.has(status) ? pick(techs) : null;
    const approver = status !== "new" ? pick(mm) : null;
    const tNum = `MT-${year}-${String(i + 1).padStart(5, "0")}`;
    const dOld = randInt(1, 90);
    const closedAt = status === "closed" ? daysAgo(randInt(0, dOld - 1)) : null;
    const repNotes = ["repaired","verified","closed"].includes(status) ? "تم الإصلاح بنجاح وفحص الجودة" : null;
    const mats = ["repaired","verified","closed"].includes(status) ? pick(["مواد لحام + أنبوب PVC","سلك كهربائي 2.5مم + قاطع","فلتر تكييف + غاز فريون","مسامير + خشب + دهان","قطع غيار مضخة","لا يوجد - إصلاح يدوي"]) : null;
    const estC = randInt(100, 15000);
    const actC = status === "closed" ? randInt(80, estC + 2000) : null;

    await conn.execute(
      "INSERT INTO tickets (ticketNumber, title, description, status, priority, category, siteId, locationDetail, reportedById, assignedToId, approvedById, repairNotes, materialsUsed, estimatedCost, actualCost, closedAt, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [tNum, title, `وصف تفصيلي: ${title}`, status, pri, cat, siteId, `الطابق ${randInt(1,10)} - الجناح ${pick(["A","B","C","D"])}`, reporter.id, assignee?.id || null, approver?.id || null, repNotes, mats, estC.toFixed(2), actC?.toFixed(2) || null, closedAt, daysAgo(dOld)]
    );
  }
  console.log(`   ✅ ${tData.length} بلاغ\n`);

  // Get tickets
  const [tRows] = await conn.execute(`SELECT id, ticketNumber, status FROM tickets WHERE ticketNumber LIKE 'MT-${year}-%' ORDER BY id`);

  // 4. STATUS HISTORY
  console.log("📜 إدخال سجل الحالات...");
  let hCount = 0;
  for (const t of tRows) {
    const sIdx = allStatuses.indexOf(t.status);
    for (let s = 0; s <= sIdx; s++) {
      const from = s === 0 ? null : allStatuses[s - 1];
      const to = allStatuses[s];
      const by = s === 0 ? pick(ops) : (s === 1 ? pick(mm) : pick(techs));
      await conn.execute("INSERT INTO ticket_status_history (ticketId, fromStatus, toStatus, changedById, notes, createdAt) VALUES (?,?,?,?,?,?)",
        [t.id, from, to, by.id, `تغيير الحالة إلى ${to}`, daysAgo(randInt(0, 60))]);
      hCount++;
    }
  }
  console.log(`   ✅ ${hCount} سجل\n`);

  // 5. PURCHASE ORDERS
  const poTickets = tRows.filter(t => ["needs_purchase","purchase_pending_estimate","purchase_pending_accounting","purchase_pending_management","purchase_approved","partial_purchase","purchased","received_warehouse","closed"].includes(t.status));
  const poSMap = { needs_purchase:"draft", purchase_pending_estimate:"pending_estimate", purchase_pending_accounting:"pending_accounting", purchase_pending_management:"pending_management", purchase_approved:"approved", partial_purchase:"partial_purchase", purchased:"purchased", received_warehouse:"received", closed:"closed" };

  console.log("🛒 إدخال طلبات الشراء...");
  let poCount = 0;
  for (const t of poTickets) {
    poCount++;
    const poS = poSMap[t.status] || "draft";
    const poNum = `PR-${year}-${String(poCount).padStart(4, "0")}`;
    const reqBy = pick(techs);
    const totEst = randInt(500, 25000);
    const totAct = ["purchased","received","closed"].includes(poS) ? randInt(400, totEst + 3000) : null;
    const accApp = ["pending_management","approved","partial_purchase","purchased","received","closed"].includes(poS) ? pick(accs) : null;
    const mgtApp = ["approved","partial_purchase","purchased","received","closed"].includes(poS) ? pick(sm) : null;

    await conn.execute(
      "INSERT INTO purchase_orders (poNumber, ticketId, requestedById, status, totalEstimatedCost, totalActualCost, totalEstimatedText, accountingApprovedById, accountingApprovedAt, managementApprovedById, managementApprovedAt, notes, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [poNum, t.id, reqBy.id, poS, totEst.toFixed(2), totAct?.toFixed(2) || null, `${totEst} ريال سعودي فقط لا غير`, accApp?.id || null, accApp ? daysAgo(randInt(1,30)) : null, mgtApp?.id || null, mgtApp ? daysAgo(randInt(0,20)) : null, "طلب شراء مواد صيانة", daysAgo(randInt(5,60))]
    );
  }
  console.log(`   ✅ ${poCount} طلب شراء\n`);

  const [poRows] = await conn.execute(`SELECT id, poNumber, status FROM purchase_orders WHERE poNumber LIKE 'PR-${year}-%' ORDER BY id`);

  // 6. PO ITEMS
  const itemNames = ["لوحة تحكم قفل إلكتروني K-55","أنبوب PVC 4 بوصة","سلك كهربائي 2.5مم نحاسي","فلتر تكييف مركزي 20x25","مضخة مياه 1 حصان","قاطع كهربائي 32A","صمام مياه نحاسي 1 بوصة","غاز فريون R410A","مفتاح إنارة ذكي","كابل شبكة Cat6","حساس حرارة للتكييف","مروحة شفط صناعية","دهان مقاوم للرطوبة","مادة عازلة للأسطح","قطع غيار مصعد","بطارية UPS","كاميرا مراقبة IP","لوحة إنذار حريق","مفتاح تحويل كهربائي","ثرموستات رقمي"];
  const units = ["قطعة","متر","لفة","علبة","جالون","كيلو","عبوة","حبة"];
  const suppliers = ["شركة المعدات الكهربائية","مؤسسة السباكة المتقدمة","شركة التبريد والتكييف","مؤسسة البناء الحديث","شركة الأمان للأنظمة","مؤسسة المواد الصناعية"];

  console.log("📦 إدخال أصناف طلبات الشراء...");
  let iCount = 0;
  for (const po of poRows) {
    const n = randInt(2, 5);
    const used = new Set();
    for (let j = 0; j < n; j++) {
      let idx; do { idx = randInt(0, itemNames.length - 1); } while (used.has(idx)); used.add(idx);
      const del = pick(dels);
      const qty = randInt(1, 10);
      const eu = randInt(50, 3000);
      const et = eu * qty;
      const isPurch = ["partial_purchase","purchased","received","closed"].includes(po.status);
      const isRecv = ["received","closed"].includes(po.status);
      const itemPurch = po.status === "partial_purchase" ? (j < n - 1) : isPurch;
      const itemRecv = itemPurch && isRecv;
      const au = itemPurch ? randInt(40, eu + 500) : null;
      const at2 = au ? au * qty : null;
      let iStatus = "pending";
      if (["pending_estimate","pending_accounting","pending_management"].includes(po.status)) iStatus = "estimated";
      if (po.status === "approved") iStatus = "approved";
      if (itemPurch) iStatus = "purchased";
      if (itemRecv) iStatus = "received";

      await conn.execute(
        "INSERT INTO purchase_order_items (purchaseOrderId, itemName, description, quantity, unit, delegateId, estimatedUnitCost, estimatedTotalCost, actualUnitCost, actualTotalCost, supplierName, status, purchasedAt, receivedAt, receivedById) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [po.id, itemNames[idx], `${itemNames[idx]} - مواصفات قياسية`, qty, pick(units), del.id, eu.toFixed(2), et.toFixed(2), au?.toFixed(2) || null, at2?.toFixed(2) || null, itemPurch ? pick(suppliers) : null, iStatus, itemPurch ? daysAgo(randInt(0,15)) : null, itemRecv ? daysAgo(randInt(0,10)) : null, itemRecv ? pick(wh).id : null]
      );
      iCount++;
    }
  }
  console.log(`   ✅ ${iCount} صنف\n`);

  // 7. INVENTORY
  const invData = [
    ["أنابيب PVC 4 بوصة",50,"متر",10,"رف A-1"],["سلك كهربائي 2.5مم",200,"متر",50,"رف A-2"],
    ["قواطع كهربائية 32A",15,"قطعة",5,"رف A-3"],["فلاتر تكييف 20x25",30,"قطعة",10,"رف B-1"],
    ["غاز فريون R410A",8,"أسطوانة",3,"رف B-2"],["صمامات مياه 1 بوصة",20,"قطعة",5,"رف C-1"],
    ["مفاتيح إنارة",40,"قطعة",10,"رف C-2"],["دهان أبيض مقاوم للرطوبة",12,"جالون",4,"رف D-1"],
    ["مادة عازلة للأسطح",6,"برميل",2,"رف D-2"],["مسامير متنوعة",500,"قطعة",100,"رف E-1"],
    ["شريط لاصق كهربائي",25,"لفة",10,"رف E-2"],["مضخات مياه صغيرة",3,"قطعة",1,"رف F-1"],
    ["حساسات حرارة",10,"قطعة",3,"رف F-2"],["كابلات شبكة Cat6",100,"متر",30,"رف G-1"],
    ["بطاريات UPS",4,"قطعة",2,"رف G-2"],["مواد لحام",15,"عبوة",5,"رف H-1"],
    ["أقفال إلكترونية",5,"قطعة",2,"رف H-2"],["مراوح شفط",3,"قطعة",1,"رف I-1"],
    ["ثرموستات رقمية",7,"قطعة",3,"رف I-2"],["خراطيم مياه",30,"متر",10,"رف J-1"],
    ["مفاتيح تحويل كهربائية",2,"قطعة",1,"رف J-2"],["سيليكون مانع تسريب",20,"أنبوب",5,"رف K-1"],
    ["قطع غيار مصاعد",4,"طقم",1,"رف K-2"],["كاميرات مراقبة IP",6,"قطعة",2,"رف L-1"],
    ["لوحات إنذار حريق",2,"قطعة",1,"رف L-2"],
  ];
  console.log("🏪 إدخال المخزون...");
  for (const [name, qty, unit, min, loc] of invData) {
    await conn.execute("INSERT INTO inventory (itemName, description, quantity, unit, minQuantity, location, siteId, lastRestockedAt) VALUES (?,?,?,?,?,?,?,?)",
      [name, `${name} - مواصفات قياسية`, qty, unit, min, loc, randInt(1,10), daysAgo(randInt(1,30))]);
  }
  console.log(`   ✅ ${invData.length} صنف\n`);

  // 8. INVENTORY TRANSACTIONS
  console.log("🔄 إدخال حركات المخزون...");
  const [invRows] = await conn.execute("SELECT id FROM inventory ORDER BY id");
  let txC = 0;
  for (const inv of invRows) {
    const n = randInt(2, 6);
    for (let t = 0; t < n; t++) {
      const type = pick(["in","in","in","out","out"]);
      const qty = randInt(1, 15);
      const reason = type === "in" ? pick(["استلام من مورد","إرجاع من فني","شراء جديد"]) : pick(["صرف لفني","استخدام في بلاغ","تالف"]);
      await conn.execute("INSERT INTO inventory_transactions (inventoryId, type, quantity, reason, performedById, createdAt) VALUES (?,?,?,?,?,?)",
        [inv.id, type, qty, reason, pick(wh).id, daysAgo(randInt(0,60))]);
      txC++;
    }
  }
  console.log(`   ✅ ${txC} حركة\n`);

  // 9. NOTIFICATIONS
  const notifT = [
    ["بلاغ جديد يحتاج اعتماد","warning"],["تم اعتماد البلاغ وإسناده لك","info"],
    ["بلاغ حرج يحتاج تدخل فوري","error"],["تم إغلاق البلاغ بنجاح","success"],
    ["طلب شراء جديد بانتظار التسعير","info"],["طلب شراء بانتظار اعتماد الحسابات","warning"],
    ["طلب شراء بانتظار اعتماد الإدارة العليا","warning"],["تم اعتماد طلب الشراء","success"],
    ["تم استلام المواد في المستودع","success"],["تنبيه: مخزون وصل للحد الأدنى","error"],
    ["تقرير الصيانة الأسبوعي جاهز","info"],["تأخر في إغلاق بلاغ منذ أسبوع","warning"],
  ];
  console.log("🔔 إدخال الإشعارات...");
  for (let i = 0; i < 50; i++) {
    const [title, type] = pick(notifT);
    const user = pick(allUsers);
    const ticket = pick(tRows);
    await conn.execute("INSERT INTO notifications (userId, title, message, type, relatedTicketId, isRead, createdAt) VALUES (?,?,?,?,?,?,?)",
      [user.id, title, `${title} - يرجى مراجعة التفاصيل واتخاذ الإجراء المناسب`, type, ticket.id, Math.random() > 0.4, daysAgo(randInt(0,30))]);
  }
  console.log("   ✅ 50 إشعار\n");

  // 10. AUDIT LOGS
  const auditT = [
    ["create","ticket"],["update","ticket"],["status_change","ticket"],["approve","ticket"],
    ["assign","ticket"],["create","purchase_order"],["approve","purchase_order"],
    ["update","purchase_order_item"],["create","inventory"],["update","inventory"],["login","user"],
  ];
  console.log("📋 إدخال سجل التدقيق...");
  for (let i = 0; i < 80; i++) {
    const [action, entity] = pick(auditT);
    const user = pick(allUsers);
    await conn.execute("INSERT INTO audit_logs (userId, action, entityType, entityId, ipAddress, createdAt) VALUES (?,?,?,?,?,?)",
      [user.id, action, entity, randInt(1,35), `192.168.${randInt(1,255)}.${randInt(1,255)}`, daysAgo(randInt(0,90))]);
  }
  console.log("   ✅ 80 سجل\n");

  // SUMMARY
  console.log("═══════════════════════════════════════════");
  console.log("✅ تم إدخال جميع البيانات التجريبية بنجاح!");
  console.log("═══════════════════════════════════════════");
  console.log(`📍 المواقع: ${sitesData.length}`);
  console.log(`👥 المستخدمين: ${usersData.length}`);
  console.log(`🎫 البلاغات: ${tData.length}`);
  console.log(`📜 سجل الحالات: ${hCount}`);
  console.log(`🛒 طلبات الشراء: ${poCount}`);
  console.log(`📦 أصناف الشراء: ${iCount}`);
  console.log(`🏪 المخزون: ${invData.length}`);
  console.log(`🔄 حركات المخزون: ${txC}`);
  console.log(`🔔 الإشعارات: 50`);
  console.log(`📋 سجل التدقيق: 80`);
  console.log("═══════════════════════════════════════════\n");

  await conn.end();
  process.exit(0);
}

seed().catch(err => { console.error("❌ خطأ:", err); process.exit(1); });
