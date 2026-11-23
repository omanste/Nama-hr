import re, sys, html as H
# usage: python3 guide-mgr-build.py <out-dir>  (after guide-mobile-build.py) → <out-dir>/guide-mgr.html
S = sys.argv[1]
src = open(f"{S}/guide-mobile.html").read()
css = src[src.index("<style>")+7 : src.index("</style>")]
logo = re.search(r'src="(data:image/png;base64,[^"]+)"', src).group(1)
css += """
.part{display:flex;align-items:center;gap:10px;margin:10px 0 2px;font:700 22px/1.3 var(--f-display);color:var(--ink)}
.part::after{content:"";flex:1;height:2px;background:var(--gold);opacity:.6;border-radius:2px}
.part small{font:500 14px/1 var(--f-body);color:var(--muted)}
.toc .sep{flex:none;align-self:center;width:2px;height:24px;background:var(--line);margin-inline:2px}
section ul{margin:0;padding-inline-start:20px;display:flex;flex-direction:column;gap:4px}
section li::marker{color:var(--gold-ink)}
header>div:first-child>span{white-space:normal!important;text-align:center;line-height:1.3!important}
"""
ARROW = '<span aria-hidden="true">←</span>'
def chips(*xs, arrow=False, rtl=True):
    sep = (f'<span aria-hidden="true">{"←" if rtl else "→"}</span>') if arrow else ""
    return "<div>" + sep.join(f"<span>{x}</span>" for x in xs) + "</div>"

AR = {
 "lang": "ar", "dir": "rtl", "badge": "دليل الموارد البشرية والمديرين",
 "h1": "اعتماد الطلبات ومتابعة الفريق",
 "sub": "أين تصل الطلبات، ومن يقرر في كل خطوة، وماذا يحدث بعد قرارك.",
 "pills": ["للمديرين المباشرين", "للموارد البشرية", "من الهاتف أو الكمبيوتر"],
 "flow_t": "مسار الطلب",
 "flow": ["الموظف يرسل", "المدير المباشر", "الموارد البشرية", "✓ يصل الموظف القرار"],
 "flow_p": "يصل كل من عليه قرار إشعار على الهاتف والكمبيوتر، ويظهر رقم على الصفحة التي فيها الطلب. فعّل الإشعارات من «المزيد» ← «الإشعارات».",
 "notif_t": "من يصله أي إشعار",
 "notif": ["<b>الموظف وحده:</b> ما يخص طلباته وحضوره ومستنداته وملفه (أُرسل، وُوفق، رُفض، تنبيهات الحضور والانصراف، انتهاء مستند).",
           "<b>مدير الطلب وحده:</b> طلب بانتظار موافقته، أو حضور من خارج مواقع العمل، وقائمة الصباح بمن لم يسجّل انصرافه من فريقه هو فقط. والنائب أثناء غيابه.",
           "<b>الموارد البشرية ومسؤول النظام:</b> ما ينتظر الموارد البشرية (إجازة بعد المدير، استئذان، تصحيح بصمة، عمل بعد الدوام، تحديثات الملفات، انتهاء المستندات، الأرصدة فوق 60 يوماً، نهاية فترة التجربة).",
           "<b>الإدارة العليا:</b> التقرير الأسبوعي (مع الموارد البشرية) والملخص الشهري.",
           "<b>الجميع:</b> أعياد الميلاد ومناسبات الشركة والأيام التي لا تُقبل فيها الإجازات."],
 "notif_p": "لا يُبلَّغ أحد بصفته «موارد بشرية» عن أمر يخصه هو؛ يصل إلى الآخرين. ورسائل «صوت الموظف» إلى الموارد البشرية خاصة بها وحدها.",
 "parts": [
  ("للمدير المباشر", "M", [
   ("الموافقات", "تبويب «الموافقات» في الشريط السفلي (أو القائمة على الكمبيوتر) وعليه عدد الطلبات المنتظرة. كل طلب في بطاقة: الموظف، النوع، التاريخ، المدة، الرصيد والسبب.",
     chips("موافقة", "رفض + السبب"), "تصلك طلبات الموظفين الذين عيّنتك الموارد البشرية مديراً مباشراً لهم، وإلا طلبات قسمك. الرفض يحتاج سبباً يصل للموظف. الإجازة المرضية والوفاة والزواج والحج والعمرة تحتاج مستنداً مرفقاً قبل الموافقة."),
   ("بعد موافقتك على الإجازة", "تنتقل الإجازة إلى الموارد البشرية للموافقة النهائية، ولا تُخصم الأيام من الرصيد إلا بعد اعتمادها. يرى الموظف في طلبه أنك وافقت وأنه بانتظار الموارد البشرية.", None, None),
   ("الاستئذان", "المغادرة المبكرة والتأخير والاستئذان خلال الدوام: وافق أو ارفض (الرفض لا يحتاج سبباً للاستراحة الشخصية). بعدها تصنّفه الموارد البشرية (مدفوع أو بدون أجر أو من الرصيد).",
     chips("طلب الموظف", "موافقتك", "بدء الاستراحة", "العودة إلى العمل", arrow=True), "في الاستراحة الشخصية يضغط الموظف «بدء الاستراحة» ثم «العودة إلى العمل»، وتُسجَّل الدقائق الفعلية. والخروج دون استئذان معتمد يظهر ⚠️ كغياب أثناء الدوام ويصلك إشعار."),
   ("تصحيح البصمة", "عند نسيان الحضور أو الانصراف يرسل الموظف الوقت الصحيح. تأكد منه ثم وافق، فتعتمده الموارد البشرية. لا تُحتسب ساعات اليوم قبل ذلك.", None, None),
   ("العمل بعد الدوام", "يُطلب السبب من الموظف عند البقاء بعد نهاية الدوام بـ 30 دقيقة. عند الموافقة يمكنك تعديل وقت الانتهاء إلى ما كلّفته به فعلاً.",
     chips("وافق كما هو", "عدّل وقت الانتهاء ثم وافق"), "بعدها تعتمده الموارد البشرية، فيدخل في تقرير العمل الإضافي."),
   ("تسجيلات عليها تنبيه ⚠️", "خارج مواقع العمل، أو «فشل التحقق بالوجه — التُقطت صورة»، أو «غير موثق»: تظهر في أعلى «الموافقات» مع السبب والمسافة والصورة 📷 والخريطة 🗺️، ويصلك إشعار.",
     chips("قبول: يُحتسب", "رفض: يُحتسب بصمة ناقصة"), "يُحفظ التسجيل ويُحتسب ما لم ترفضه. وعند الرفض يطلب الموظف تصحيحاً لذلك اليوم."),
   ("المهام الخارجية", "يطلبها الموظف قبل الخروج (يوماً أو عدة أيام لموقع بعيد). وافق قبل موعدها، فتُحتسب وقت عمل وتُحسب علاوتها إن كانت خارج مسقط.", None, None),
   ("النائب أثناء غيابك", "في أسفل «الموافقات»: «النائب أثناء غيابي». اختر النائب والتاريخين، فتذهب الطلبات الجديدة إليه ويمكنه البت في المنتظرة.", None, "عند طلب إجازتك السنوية يُطلب منك اختيار النائب."),
   ("متابعة حضور الفريق", "«تقارير الحضور» تعرض حسب القسم وحسب الموظف: الالتزام والتأخير والخروج المبكر والغياب والوقت بعد الدوام. اختر المصدر في الأعلى، ويُحسب كل شيء منه فقط:",
     chips("الإلكتروني فقط", "البصمة فقط", "مدمج (📱 إلكتروني · 👆 بصمة)"), "افتح اسم الموظف لترى شهره سطراً لكل يوم (📍 الموقع، 📷 الصورة، 🗺️ الخريطة، ⚠️ تنبيه). «تقرير الحضور الشهري (PDF / Excel)»: اختر الشهر والفريق كله أو موظفاً واحداً والمصدر. كل ملف PDF يُفتح أولاً في معاينة: كبّر، غيّر الخيارات، ثم نزّله أو اطبعه. ويصل الموظف تنبيه إن لم يسجّل حضوره أو انصرافه، وكل صباح يصلك من لم يسجّل انصرافه أمس من فريقك."),
   ("سجل الحضور الإلكتروني", "من سجّل حضوره إلكترونياً ومتى وأين، يوماً بيوم. صفِّ بالتاريخ والموظف والتنبيهات (الكل، المنبَّه عليها فقط، غير الموثقة فقط).",
     chips("تصدير Excel", "تصدير PDF"), "الملف يتبع التصفية: الرقم الوظيفي، الاسم، التاريخ، الحضور، الانصراف، الموقع (داخل أو خارج والمسافة)، طريقة التحقق، التنبيه، قرار المدير، والحالة."),
   ("تقرير الاستئذانات", "لكل موظف: الخروج المبكر والتأخير والاستئذان خلال الدوام، وتصنيف الأجر، وما ينتظر الموارد البشرية — عدد المرات والساعات. يراه المدير لفريقه، والموارد البشرية للجميع.",
     chips("تصدير PDF", "تصدير Excel"), "اختر الشهر أو فترة، وفي PDF يمكن إضافة كل استئذان لكل موظف."),
  ]),
  ("للموارد البشرية", "H", [
   ("الإجازات بعد المدير", "في «الموافقات» تظهر على البطاقة علامة «وافق المدير — القرار النهائي لك».",
     chips("موافقة: تُخصم الأيام", "رفض + السبب", "تأجيل (السنوية حتى 6 أشهر)"), "يقبلها أي حساب موارد بشرية. طلب موظف الموارد البشرية نفسه يذهب إلى حساب موارد بشرية آخر."),
   ("بانتظار الموارد البشرية", "في «تقارير الحضور» قائمة «بانتظار الموارد البشرية» وعليها العدد. اضغط على الطلب لتقرر:",
     None, "<ul><li><b>الاستئذان:</b> حق نظامي مدفوع، إذن خاص مدفوع، بدون أجر، أو من الإجازة السنوية.</li><li><b>تصحيح البصمة:</b> اعتماد أو رفض.</li><li><b>العمل بعد الدوام:</b> اعتماد (مع تعديل وقت الانتهاء إن لزم) أو رفض.</li></ul>"),
   ("تحديثات الملفات", "ما يعدّله الموظفون في ملفاتهم (البيانات، العنوان، الحساب البنكي، المستندات) يُحفظ فوراً ويظهر هنا مع تاريخ ووقت التعديل ومن قام به، وبجانب السابق والجديد المستند للمقارنة (البطاقة أو الجواز أو الشهادات). تحقق منه، أو أعد القيمة السابقة مع ذكر السبب، فيصل الموظف إشعار.", chips("تحقق", "إعادة القيمة السابقة + السبب"), None),
   ("مراجعة الأرصدة", "من تجاوز رصيده 60 يوماً عند تاريخ تعيينه يظهر في «مراجعة الأرصدة» لتقرر الإبقاء على الزيادة لحاجة العمل أو غير ذلك. لا يُحذف شيء تلقائياً.", None, None),
   ("الموظفون", "تبويب «الموظفون» للموارد البشرية والمسؤول فقط: الرقم الوظيفي، الاسم (بلغة الواجهة)، القسم، المسمى الوظيفي، تاريخ التعيين، رصيد الإجازة المتبقي، والحالة. صفِّ بالحالة والقسم والمسمى أو ابحث بالاسم أو الرقم، واضغط عنوان العمود للترتيب.",
     chips("نشط", "في إجازة (تلقائياً)", "مستقيل", "منتهي الخدمة", "غير نشط"), "«تصدير Excel» و«تصدير PDF» يتبعان التصفية واللغة. «في إجازة» تُضبط تلقائياً أثناء الإجازة المعتمدة. المستقيل ومنتهي الخدمة يحتاجان آخر يوم عمل ولا يمكنهما الدخول. ومربع «بيانات ناقصة» يعدّ من ينقصه القسم أو المسمى أو تاريخ التعيين أو الاسم بإحدى اللغتين."),
   ("ملف الموظف والوردية", "افتح الملف لتعديل أي قسم أو ضبط الرصيد («تعيين الرصيد إلى» عدد أيام). في بطاقة «الوظيفة» اختر المدير المباشر والوردية: المرن (حضور 08:30–09:15، الانصراف بعد 9 ساعات)، أو 10–5، أو 10–6. يسري تغيير الوردية من اليوم التالي. سجّل الجنس لكل موظف (يحدد ظهور إجازة الأمومة أو الأبوة). الرقم الوظيفي بصيغة NAMA-007.", None,
     "أرقام الهواتف تُحفظ كاملة برمز الدولة. صلة قرابة جهة الطوارئ من قائمة العائلة (يعدّلها مسؤول النظام من «الإعدادات»)، و«تقرير تحويل أرقام الهواتف وصلات القرابة» في «الموظفون» يعرض ما يحتاج مراجعة."),
   ("الحضور", "ارفع ملف جهاز البصمة من «رفع ملف البصمة». كل بصمة تحفظ مصدرها: البصمة أو الإلكتروني. في «تقارير الحضور» وكشف الموظف والملف الشهري اختر المصدر: الإلكتروني فقط، البصمة فقط، أو مدمج.", None,
     "تسجيلات قديمة لم يُعرف مصدرها تظهر في قائمة أعلى «تقارير الحضور» ولا تُحتسب حتى تُراجع. مواعيد التنبيه يغيّرها مسؤول النظام من «الإعدادات» ← «مواقع العمل»."),
   ("العمل الإضافي والعلاوات", "«العمل الإضافي»: ساعات كل موظف المعتمدة في الشهر، النهارية والليلية أو أيام الراحة، والساعات المدفوعة. «علاوات المهام الخارجية»: أسعار اليوم والمبيت وتقرير الشهر. للحسابات ملف Excel لكل منهما.", chips("المعامل: نهار ×1.25", "ليل وراحة وعطل ×1.5"), "تغيّر الموارد البشرية الأسعار والمعاملات في أعلى الصفحة، ويحتفظ كل طلب بسعره عند اعتماده."),
   ("تدقيق الملفات مع المستندات", "في «تحديثات الملفات» اضغط «تدقيق وتحديث الآن»: يقرأ آخر بطاقة مدنية وجواز لكل موظف. البيانات الشخصية تُؤخذ من البطاقة المدنية فقط، ومن الجواز رقمه وتاريخ انتهائه.",
     chips("ما صُحّح تلقائياً", "للمراجعة — لم يُغيَّر", "تعذّرت قراءته", "تنزيل Excel"), "ما تؤكده البطاقة يُصحَّح تلقائياً؛ وما لا تؤكده يظهر «للمراجعة» مع المستند لتصحّحه يدوياً. وعلى كل مستند زر «🔍 قراءة وتحديث البيانات» لموظف واحد."),
   ("البلاغات (لمسؤول النظام)", "ما يبلّغ عنه الموظفون والموارد البشرية بزر «⚠ الإبلاغ عن خطأ» في الملف أو «💬 ملاحظة» على المستند يُجمع في «ملاحظات على قراءة المستندات»، ولا يراه إلا مسؤول النظام.",
     chips("📦 تنزيل ملف البلاغات والمستندات"), "ملف واحد (.zip) فيه البلاغات وما قرأه النظام والمستندات المرتبطة، يُرسل لمعالجة القراءة. فيه بيانات شخصية: احذفه بعد إرساله."),
   ("التحقق عند الحضور", "بالترتيب: الموقع أولاً (إلزامي؛ خارج المواقع يُحفظ مع ⚠️ والمسافة)، ثم الوجه أو البصمة، والصورة بديل إذا فشل — محاولتان إضافيتان، وإلا يُحفظ «غير موثق».",
     chips("الإعدادات ← التحقق عند الحضور", "لكل موظف: افتراضي / تشغيل / إيقاف"), "يغيّر هذه الإعدادات مسؤول النظام فقط، للشركة أو لموظف واحد من ملفه. في ملف الموظف بطاقة «أجهزة التحقق بالوجه» للأجهزة المسجّلة وإزالة جهاز ضائع. والتسجيلات عليها تنبيه تصل المدير المباشر والموارد البشرية."),
   ("التقويم", "أضف العطل الرسمية والمناسبات، وعدّل المناسبات الوطنية لهذه السنة أو احذفها لكل السنوات.", None, None),
   ("تحديثات نظام الموارد البشرية", "تبويب للموارد البشرية والمسؤول: كل تحديث على بوابة الموارد البشرية بين تاريخين — المجال والنوع (ميزة جديدة، تحسين، إصلاح) والبيئة وتاريخها، مع الملخص.",
     chips("تنزيل PDF", "تنزيل Excel"), "يضيف مسؤول النظام تحديثاً أو يعدّل صياغته أو يخفيه؛ والموارد البشرية تعرض وتنزّل."),
   ("نسخ الموارد البشرية (لمسؤول النظام)", "نسخة كاملة لبيانات الموارد البشرية أو الإعدادات فقط. وعند الاستعادة تُعرض المعاينة قسماً قسماً قبل التنفيذ، ولا يتكرر شيء موجود.", None, "كل نسخة واستعادة مسجّلة مع من قام بها ومتى."),
  ]),
 ],
 "foot_t": "هل يظهر لك كل شيء؟",
 "foot": "إن لم يظهر تبويب «الموافقات» أو قائمة الموارد البشرية، تأكد أن دور حسابك صحيح في «المستخدمون» (مدير، موارد بشرية). وللمساعدة تواصل مع مسؤول النظام.",
 "toc": "الخطوات",
}
EN = {
 "lang": "en", "dir": "ltr", "badge": "HR & managers guide",
 "h1": "Approving requests and following your team",
 "sub": "Where requests arrive, who decides at each step, and what happens after your decision.",
 "pills": ["Direct managers", "HR", "Phone or computer"],
 "flow_t": "How a request moves",
 "flow": ["Staff member sends", "Direct manager", "HR", "✓ Decision reaches them"],
 "flow_p": "Whoever has to decide gets a notification on phone and computer, and a count shows on the page that holds the request. Turn notifications on from “More” → “Notifications”.",
 "notif_t": "Who gets which notification",
 "notif": ["<b>Only the staff member:</b> their own requests, attendance, documents and profile (sent, approved, rejected, check-in and check-out reminders, a document expiring).",
           "<b>Only that request's manager:</b> a request waiting for their approval, a check-in outside the work sites, and the morning list of who didn't check out from their own team only. Their deputy while they're away.",
           "<b>HR and the system admin:</b> what waits for HR (leave after the manager, permissions, fingerprint corrections, after-hours time, profile updates, expiring documents, balances over 60 days, probation ending).",
           "<b>Top management:</b> the weekly report (with HR) and the monthly summary.",
           "<b>Everyone:</b> birthdays, company occasions and days when leave can't be booked."],
 "notif_p": "Nobody is notified “as HR” about their own case; it goes to the others. Staff Voice messages to HR stay with HR only.",
 "parts": [
  ("For direct managers", "M", [
   ("Approvals", "The “Approvals” tab on the bottom bar (or the menu on a computer) shows how many requests are waiting. Each request is a card: the person, type, dates, length, balance and reason.",
     chips("Approve", "Reject + reason", rtl=False), "You get the requests of the people HR made you direct manager of, otherwise your department's. A rejection needs a reason, which the person sees. Sick, bereavement, marriage, Hajj and Umrah leave need a document attached before approval."),
   ("After you approve leave", "Leave then goes to HR for the final approval; days come off the balance only after HR approves. The person sees that you approved and that it waits for HR.", None, None),
   ("Permissions", "Early leave, late arrival and personal breaks: approve or reject (no reason needed to reject a personal break). HR then classifies it (paid, unpaid or from annual leave).",
     chips("Staff member asks", "You approve", "Start the break", "Back to work", arrow=True, rtl=False), "With a personal break the person presses “Start the break”, then “Back to work”, and the minutes actually taken are recorded. Leaving without an approved permission shows ⚠️ as time away, and you are notified."),
   ("Fingerprint corrections", "When someone forgot to check in or out they send the right time. Check it, then approve; HR confirms it. The day's hours don't count until then.", None, None),
   ("Extra time after hours", "Staying 30 minutes past the shift asks the person for a reason. When you approve you can change the end to the time you actually asked for.",
     chips("Approve as is", "Change the end, then approve", rtl=False), "HR then confirms it, and it goes into the overtime report."),
   ("Flagged check-ins ⚠️", "Outside the work sites, “Face ID failed — photo taken” or “Unverified”: they show at the top of “Approvals” with the reason, the distance, the photo 📷 and the map 🗺️, and you are notified.",
     chips("Accept: it counts", "Reject: counts as a missing punch", rtl=False), "The check-in is saved and counts unless you reject it. After a rejection the person asks for a correction for that day."),
   ("External work tasks", "Staff request them before they go (one day, or several for a distant site). Approve beforehand; it counts as work time, with an allowance outside Muscat.", None, None),
   ("Cover while you're away", "At the bottom of “Approvals”: “Cover while I'm away”. Pick the deputy and the dates; new requests go to them and they can decide waiting ones.", None, "When you apply for your own annual leave you are asked to pick a deputy."),
   ("Following your team's attendance", "“Attendance reports” show by department and by person: compliance, lateness, early exits, absence and time after hours. Choose the source at the top; everything is worked out from it only:",
     chips("Online only", "Fingerprint only", "Combined (📱 online · 👆 fingerprint)", rtl=False), "Open a name to see their month, one line per day (📍 place, 📷 photo, 🗺️ map, ⚠️ flag). “Monthly attendance PDF / Excel”: pick the month, the whole team or one person, and the source. Every PDF opens in a preview first: zoom, change the options, then Download or Print. Staff are reminded when they haven't checked in or out, and each morning you get the list of who on your team didn't check out yesterday."),
   ("Online check-in log", "Who checked in online, when and where, day by day. Filter by date, person and flags (all, flagged only, unverified only).",
     chips("Export Excel", "Export PDF", rtl=False), "The file follows the filters: employee no., name, date, check-in, check-out, location (inside or outside and the distance), method, flag, manager decision and status."),
   ("Permissions report", "For each person: early leave, late arrival and personal breaks, the pay category and what waits for HR — how many times and how many hours. Managers see their team; HR sees everyone.",
     chips("Export PDF", "Export Excel", rtl=False), "Pick a month or a period; the PDF can also list each permission per person."),
  ]),
  ("For HR", "H", [
   ("Leave after the manager", "In “Approvals” the card says “Manager approved — final decision is yours”.",
     chips("Approve: days come off", "Reject + reason", "Postpone (annual, up to 6 months)", rtl=False), "Any HR account can decide. An HR staff member's own request goes to another HR account."),
   ("Waiting for HR", "“Attendance reports” has a “Waiting for HR” list with its count. Open a request to decide:",
     None, "<ul><li><b>Permissions:</b> statutory paid, special paid, unpaid, or from annual leave.</li><li><b>Fingerprint corrections:</b> confirm or refuse.</li><li><b>Extra time after hours:</b> confirm (changing the end if needed) or refuse.</li></ul>"),
   ("Profile updates", "What staff change in their profile (details, address, bank account, documents) is saved at once and shows here with the date and time and who made it, and beside before / after the document to compare (ID, passport or certificates). Verify it, or put the old value back with a reason; the person is notified.", chips("Verify", "Put the old value back + reason", rtl=False), None),
   ("Balance reviews", "Anyone over 60 days at their join anniversary shows in “Balance reviews”, so you decide whether to keep the excess for work needs. Nothing is removed automatically.", None, None),
   ("Staff", "The “Staff” tab is for HR and Admin only: employee no., name (in the screen's language), department, job title, date of employment, leave days left and status. Filter by status, department and job title or search by name or number; tap a column header to sort.",
     chips("Active", "On leave (automatic)", "Resigned", "Terminated", "Inactive", rtl=False), "“Export Excel” and “Export PDF” follow the filters and the language. “On leave” is set by itself during approved leave. Resigned and Terminated need the last working day and can no longer sign in. The “Missing details” box counts who has no department, job title, join date, or a name in either language."),
   ("A profile and the shift", "Open a profile to edit any section or set the balance (“Set balance to” N days). On the “Job” card choose the direct manager and the shift: Flexible (in 08:30–09:15, out 9 hours later), 10–5 or 10–6. A shift change applies from the next day. Record everyone's gender (it decides whether maternity or paternity leave shows). Staff IDs are written NAMA-007.", None,
     "Phone numbers are saved in full with the country code. The emergency contact's relationship comes from the family list (the system admin edits it in “Settings”), and the phone and relationship conversion report on “Staff” lists what needs a look."),
   ("Attendance", "Upload the fingerprint machine's file from “Upload fingerprint file”. Every punch keeps its source: fingerprint or online. In “Attendance reports”, a person's month and the monthly file, choose the source: Online only, Fingerprint only, or Combined.", None,
     "Older check-ins whose source couldn't be told are listed at the top of “Attendance reports” and count nowhere until checked. The reminder times are changed by the system admin in “Settings” › “Work sites”."),
   ("Overtime and allowances", "“Overtime”: each person's confirmed hours this month, daytime and night or rest-day, with the paid hours. “Task allowances”: the day and overnight rates and the month's report. Each has an Excel file for Accounts.", chips("Daytime ×1.25", "Night, rest days, holidays ×1.5", rtl=False), "HR changes the rates and multipliers at the top of the page; each request keeps the rate it was confirmed at."),
   ("Check profiles against documents", "In “Profile updates” press “Check and update now”: it reads each person's latest civil ID and passport. Personal details come from the civil ID only; the passport gives its number and expiry.",
     chips("Corrected automatically", "To check — not changed", "Couldn't be read", "Download Excel", rtl=False), "What the card confirms is corrected automatically; what it can't confirm is listed “to check” with the document, to correct by hand. Each document also has “🔍 Read and update details” for one person."),
   ("Reports (system admin)", "What staff and HR report with “⚠ Report a mistake” on a profile or “💬 Feedback” on a document is collected in “Feedback on document readings”, which only the system admin sees.",
     chips("📦 Download reports and documents", rtl=False), "One file (.zip) with the reports, what the reader read and the related documents, to send for fixing the reading. It holds personal data: delete it once it's sent."),
   ("Check-in verification", "In this order: the location first (required; outside the work sites it is saved with ⚠️ and the distance), then Face ID or the fingerprint, and a photo if that fails — two more tries, otherwise it is saved “Unverified”.",
     chips("Settings › Check-in verification", "Per person: Default / On / Off", rtl=False), "Only the system admin changes these, for the company or for one person on their profile. A profile's “Phones for face verification” card lists the registered phones and removes a lost one. Flagged check-ins go to the direct manager and HR."),
   ("Calendar", "Add official holidays and occasions; edit a national day for this year, or remove it for every year.", None, None),
   ("HR system updates", "A tab for HR and Admin: every change to the HR portal between two dates — area and type (new feature, improvement, fix), the environment and its date — with a summary.",
     chips("Download PDF", "Download Excel", rtl=False), "The system admin adds an update, rewords or hides one; HR views and downloads."),
   ("HR backup (system admin)", "A full backup of the HR data, or the settings only. Restoring shows a preview section by section first, and nothing already there is duplicated.", None, "Every backup and restore is logged with who and when."),
  ]),
 ],
 "foot_t": "Can you see everything?",
 "foot": "If the “Approvals” tab or the HR lists don't show, check your account's role in “Users” (manager, HR). For help, contact the system administrator.",
 "toc": "Steps",
}
def panel(L):
    rtl = L["dir"] == "rtl"; lg = L["lang"]
    pills = "".join(f"<span>{p}</span>" for p in L["pills"])
    btns = '<div class="lang" role="group" aria-label="Language"><button type="button" data-l="ar">عربي</button><button type="button" data-l="en">English</button></div>'
    head = (f'<header><div><img src="{logo}" alt="Nama"><span>{L["badge"]}</span></div>'
            f'<div><h1>{L["h1"]}</h1><p>{L["sub"]}</p></div><div>{pills}</div></header>')
    flow = (f'<section id="{lg}-0"><div><span>↹</span><h2>{L["flow_t"]}</h2></div>'
            + chips(*L["flow"], arrow=True, rtl=rtl) + f'<p>{L["flow_p"]}</p></section>')
    notif = (f'<section id="{lg}-n"><div><span>🔔</span><h2>{L["notif_t"]}</h2></div><ul>' + "".join(f"<li>{x}</li>" for x in L["notif"]) + f'</ul><p>{L["notif_p"]}</p></section>')
    body, toc, n = [flow, notif], [], 0
    for title, key, steps in L["parts"]:
        body.append(f'<h2 class="part" id="{lg}-{key}">{title}</h2>')
        if toc: toc.append('<span class="sep" aria-hidden="true"></span>')
        for (t, p, ch, extra) in steps:
            n += 1
            ex = "" if not extra else (extra if extra.startswith("<ul>") else f"<p>{extra}</p>")
            body.append(f'<section id="{lg}-{n}"><div><span>{n}</span><h2>{t}</h2></div><p>{p}</p>{ch or ""}{ex}</section>')
            toc.append(f'<a href="#{lg}-{n}" aria-label="{n}">{n}</a>')
    foot = (f'<footer><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#DCB96B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
            f'<div><b>{L["foot_t"]}</b><span>{L["foot"]}</span></div></footer>')
    return (f'<div class="panel" lang="{lg}" dir="{L["dir"]}" id="p-{lg}"{"" if rtl else " hidden"}>'
            f'<div class="top"><div class="wrap">{btns}{head}</div></div>'
            f'<div class="wrap"><nav class="toc" aria-label="{L["toc"]}">{"".join(toc)}</nav><main>{"".join(body)}</main>{foot}</div></div>')
js = src[src.index("<script>"):src.index("</script>")+9].replace("guide.lang", "mgrguide.lang")
out = f"""<title>دليل الموارد البشرية والمديرين · نماء</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&amp;family=Readex+Pro:wght@500;600;700&amp;display=swap">
<style>{css}</style>
{panel(AR)}
{panel(EN)}
{js}
"""
open(f"{S}/guide-mgr.html", "w").write(out); print(len(out))
