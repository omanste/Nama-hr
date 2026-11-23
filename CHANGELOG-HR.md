# HR portal — changelog | سجل تحديثات بوابة الموارد البشرية

Every change to the HR portal, newest day first, in plain English · Arabic. The HR portal reads this file on every deploy
and shows it under «HR system updates · تحديثات نظام الموارد البشرية»: each entry gets the environment it reached
(dev / test / production) and when. Admin can reword or hide an entry in the portal.

How to write an entry (one per change, under the day it was made):

    ## 2026-11-22
    - [Area · Type] English title | العنوان بالعربية
      One or two plain sentences in English | جملة أو جملتان بالعربية
      key: short-unique-key · commit: abc1234 · dev: 2026-11-22 19:13 · production: 2026-11-25 10:00

- Area: Profiles, Attendance, Shifts, Verification, Permissions, Leave, Calendar, Reports, Backup, General.
  Anything else (Sales, Rental, Reception, Maintenance, Properties, …) is not shown in the HR portal.
- Type: New feature, Improvement or Fix.
- The last line is optional. Leave out the environment dates for a new change: the server records the date and
  version of the deploy that brings it. When a change goes to production, its production date is recorded the same way.
- No code words: write what staff, HR or managers can now do.

The history before this page existed (26 October – 22 November 2026) was filled in from the project history; its dates
are the dates of each change on dev.

## 2026-11-23
- [Attendance · Improvement] Online check-in log: one line per person per day | سجل الحضور الإلكتروني: سطر واحد لكل موظف في اليوم
  Date, number, name on one line, department, check-in and check-out with small icons (🔐 📷 🗺️ ⚠️), hours and the place — all in one row; phones get a card per row. | التاريخ والرقم والاسم في سطر واحد والقسم والحضور والانصراف مع أيقونات صغيرة (🔐 📷 🗺️ ⚠️) والساعات والموقع — كلها في سطر واحد، وفي الهاتف بطاقة لكل سطر.
  key: checkin-log-one-line
- [Profiles · Improvement] Experience before Nama, at Nama and in total | الخبرة قبل نماء وفي نماء والإجمالي
  Staff enter their experience before Nama in years and months with their previous employers; the profile adds the time at Nama (from the join date) for the total. | يُدخل الموظف خبرته قبل نماء بالسنوات والأشهر مع جهات العمل السابقة، ويضيف الملف المدة في نماء (من تاريخ التعيين) ليظهر الإجمالي.
  key: prior-experience
- [Profiles · Improvement] Qualifications: certified levels from a list, a graduation date for each, languages as ticks, experience from the join date | المؤهلات: المستوى من قائمة معتمدة وتاريخ تخرج لكل مؤهل واللغات بالاختيار والخبرة من تاريخ التعيين
  Add a line for each specialization with its level and graduation date; tick Arabic and English (and type any other language); years of experience are worked out from the join date. | أضف سطراً لكل تخصص مع المستوى وتاريخ التخرج، واختر العربية والإنجليزية (واكتب أي لغة أخرى)، وتُحسب سنوات الخبرة من تاريخ التعيين.
  key: qual-lists-v2
- [Profiles · Improvement] Degrees and courses with their year, and how long ago | المؤهلات العلمية والدورات مع سنة التخرج ومدتها
  Each degree (diploma to PhD, with the specialization) and each course has its year; the profile lists them newest first with how many years ago. | لكل مؤهل علمي (من الدبلوم إلى الدكتوراه مع التخصص) ولكل دورة سنتها، ويعرضها الملف من الأحدث مع عدد السنوات منذ الحصول عليها.
  key: degree-years
- [Profiles · Improvement] Work e-mail and personal e-mail side by side in the contact details | البريد الإلكتروني للعمل والبريد الشخصي جنباً إلى جنب في بيانات التواصل
  HR sets the work e-mail from the Contact window next to the personal one; staff see it there but can't change it. | تضبط الموارد البشرية بريد العمل من نافذة التواصل بجانب البريد الشخصي، ويراه الموظف دون أن يغيّره.
  key: work-email-contact
- [Verification · Improvement] iPhone Face ID setup steps when the phone can't save the key | خطوات تجهيز الآيفون عند تعذّر حفظ مفتاح التحقق بالوجه
  When an iPhone can't register for Face ID check-in, the portal now shows the two iPhone settings to turn on, then “Try again”. | عند تعذّر تسجيل الآيفون للتحقق بالوجه تعرض البوابة الإعدادين المطلوب تفعيلهما في الآيفون ثم «حاول مرة أخرى».
  key: ios-passkey-setup
- [Attendance · New feature] Attendance by punch source: Online only, Fingerprint only or Combined | الحضور حسب المصدر: الإلكتروني فقط أو البصمة فقط أو مدمج
  Every punch records where it came from. The attendance report, a person's month, My attendance and the monthly PDF / Excel count only the chosen source; Combined shows 📱 online or 👆 fingerprint next to each time. | كل بصمة تحفظ مصدرها، ويحسب تقرير الحضور وكشف الموظف الشهري و«حضوري» وملف PDF / Excel الشهري المصدر المختار فقط، ويعرض «مدمج» 📱 إلكتروني أو 👆 بصمة بجانب كل وقت.
  key: punch-source
- [Reports · New feature] Online check-in log: export to Excel and PDF | سجل الحضور الإلكتروني: تصدير Excel وPDF
  The log can be filtered to flagged or unverified check-ins and downloaded with location, method, flag, manager decision and status. | يمكن تصفية السجل على التسجيلات المنبَّه عليها أو غير المتحقق منها، وتنزيله مع الموقع وطريقة التحقق والتنبيه وقرار المدير والحالة.
  key: checkin-log-export
- [Reports · Improvement] Every HR PDF opens in a preview first | كل ملفات PDF في الموارد البشرية تُعرض أولاً للمعاينة
  A pop-up shows the pages with zoom and a page counter; the report's options can be changed inside it, then Download or Print. | نافذة تعرض الصفحات مع التكبير وعدّاد الصفحات، ويمكن تغيير خيارات التقرير داخلها، ثم التنزيل أو الطباعة.
  key: pdf-preview
- [Attendance · Improvement] One neat line per day in the attendance sheet | سطر واحد مرتب لكل يوم في كشف الحضور
  Each day is a single aligned row: times with small icons for the place, photo, map and flags; the place shows on tap; phones get a card per day. The same layout is used in the monthly PDF and Excel. | كل يوم في سطر واحد متناسق: الأوقات مع أيقونات صغيرة للموقع والصورة والخريطة والتنبيهات، ويظهر الموقع عند الضغط، وفي الهاتف بطاقة لكل يوم، ونفس الترتيب في PDF وExcel الشهري.
  key: day-rows
- [Profiles · Improvement] Emergency contact relationship in one language | صلة قرابة جهة الطوارئ بلغة واحدة
  The list shows only the screen's language, the choice is saved once for both languages, and “Other family member” must say who it is. | تعرض القائمة لغة الواجهة فقط، ويُحفظ الاختيار مرة واحدة للغتين، ويجب كتابة من هو عند اختيار «فرد آخر من العائلة».
  key: relation-one-language

## 2026-11-22
- [Reports · New feature] HR system updates page | صفحة تحديثات نظام الموارد البشرية
  A new tab lists every change made to the HR portal between two dates, by area and type, with the environments and dates; HR and Admin can download it as PDF or Excel for management. | تبويب جديد يعرض كل تحديث على بوابة الموارد البشرية بين تاريخين حسب المجال والنوع مع البيئات والتواريخ، ويمكن للموارد البشرية والإدارة تنزيله PDF أو Excel للإدارة العليا.
  key: hr-updates-page
- [Profiles · Improvement] Staff list with export to Excel and PDF | قائمة الموظفين مع التصدير إلى Excel وPDF
  The Staff tab shows employee no., name, department, job title, date of employment, leave days left and status, with one name in the screen's language, filters, sorting and Excel / PDF downloads. | يعرض تبويب الموظفين الرقم الوظيفي والاسم والقسم والمسمى الوظيفي وتاريخ التعيين والرصيد المتبقي والحالة، باسم واحد بلغة الواجهة، مع التصفية والترتيب والتنزيل Excel وPDF.
  key: staff-list-export
- [Profiles · Improvement] Staff status: On leave set by itself, last working day kept | حالة الموظف: «في إجازة» تلقائياً وحفظ آخر يوم عمل
  “On leave” is set during approved leave and goes back to Active after it; Resigned and Terminated keep the last working day and can no longer sign in; every status change is logged. | تُضبط «في إجازة» أثناء الإجازة المعتمدة وتعود «نشط» بعدها، ويُحفظ آخر يوم عمل للمستقيل ومنتهي الخدمة ولا يمكنهما الدخول، وكل تغيير في الحالة مسجَّل.
  key: staff-status
- [Profiles · Improvement] Phone numbers with the country code; family-only emergency contact | أرقام الهواتف برمز الدولة؛ جهة الطوارئ من العائلة فقط
  Every phone field has the country with its flag and checks the length; numbers are saved in full. The emergency contact's relationship is chosen from a family list, and older records were converted once after a backup. | كل حقل هاتف فيه الدولة وعلمها ويتحقق من الطول وتُحفظ الأرقام كاملة. وتُختار صلة قرابة جهة الطوارئ من قائمة العائلة، وحُوِّلت السجلات القديمة مرة واحدة بعد نسخة احتياطية.
  key: 6e371eb · commit: 6e371eb · dev: 2026-11-22 21:28Z
- [Profiles · Fix] The new electronic ID copy reads the full English name | قراءة الاسم الإنجليزي كاملاً من نسخة البطاقة الإلكترونية الجديدة
  The 2026 electronic civil ID copy is recognised; a family name printed over two lines is read whole and never lengthened. | تُعرف نسخة البطاقة المدنية الإلكترونية لعام 2026، ويُقرأ اسم العائلة المطبوع على سطرين كاملاً دون زيادة.
  key: 9c6befe · commit: 9c6befe · dev: 2026-11-22 21:01Z
- [Shifts · New feature] Three shifts: Flexible, 10–5 and 10–6 | ثلاث مناوبات: مرنة و10–5 و10–6
  Everyone is on the Flexible shift; HR and Admin can move a person to 10–5 or 10–6 from the next day, and earlier days keep the shift they were worked under. | الجميع على المناوبة المرنة، ويمكن للموارد البشرية والإدارة نقل الموظف إلى 10–5 أو 10–6 من اليوم التالي، وتبقى الأيام السابقة على مناوبتها.
  key: 3d0641a-shifts · commit: 3d0641a · dev: 2026-11-22 20:52Z
- [Permissions · New feature] Personal break: approval, start and “Back to work” | الاستراحة الشخصية: الموافقة والبدء و«العودة للعمل»
  A personal break is asked for and approved first; the person starts it and taps “Back to work”, and time away without approval is flagged. | تُطلب الاستراحة الشخصية وتُعتمد أولاً، ثم يبدأها الموظف ويضغط «العودة للعمل»، ويُنبَّه على الغياب دون موافقة.
  key: 3d0641a-breaks · commit: 3d0641a · dev: 2026-11-22 20:52Z
- [Reports · New feature] Permissions report with PDF and Excel | تقرير الاستئذانات بصيغة PDF وExcel
  A compact table per person (early leave, late arrival, personal break, paid categories, awaiting HR), downloadable for management. | جدول مختصر لكل موظف (خروج مبكر، تأخير، استراحة شخصية، تصنيفات الأجر، بانتظار الموارد البشرية) قابل للتنزيل للإدارة.
  key: 3d0641a-report · commit: 3d0641a · dev: 2026-11-22 20:52Z
- [Backup · New feature] HR backup and restore | النسخ الاحتياطي والاستعادة للموارد البشرية
  Admin downloads a full HR backup or the settings alone, previews a file section by section before restoring, and restores without making duplicates; each backup is listed. | يُنزّل المسؤول نسخة كاملة أو الإعدادات فقط، ويعاين الملف قسماً قسماً قبل الاستعادة، ويستعيد دون تكرار، وتُسجَّل كل نسخة.
  key: 3240997 · commit: 3240997 · dev: 2026-11-22 20:25Z
- [Verification · Improvement] Check-in checks in order: location, Face ID, then photo | التحقق عند الحضور بالترتيب: الموقع ثم بصمة الوجه ثم الصورة
  Location is checked first, then Face ID; a photo is the fallback with two retries, otherwise the check-in is marked Unverified for review. | يُتحقق من الموقع أولاً ثم بصمة الوجه، والصورة بديل مع محاولتين، وإلا يُعلَّم الحضور «غير متحقق» للمراجعة.
  key: ecba87a · commit: ecba87a · dev: 2026-11-22 19:58Z
- [Profiles · Fix] Staff ID already used: the message names who has it | الرقم الوظيفي مستخدم: الرسالة تذكر صاحبه
  When a staff ID is taken, the message names the record that has it, with a link to open it. | عند استخدام الرقم الوظيفي تذكر الرسالة السجل الذي يحمله مع رابط لفتحه.
  key: d853929 · commit: d853929 · dev: 2026-11-22 19:43Z
- [Profiles · Improvement] Staff IDs in one format (NAMA-007) | الأرقام الوظيفية بصيغة واحدة (NAMA-007)
  Staff IDs are written NAMA- with three digits, new staff continue the sequence, and the same number can't be on two records. | تُكتب الأرقام الوظيفية NAMA- بثلاثة أرقام، ويستمر التسلسل للموظفين الجدد، ولا يتكرر الرقم في سجلين.
  key: 423a4fc · commit: 423a4fc · dev: 2026-11-22 19:36Z
- [Verification · New feature] Check-in verification controls | إعدادات التحقق عند الحضور
  Photo, Face ID and location checks can be switched on or off for the company and for one person; a failed check is flagged for review instead of refused. | يمكن تشغيل أو إيقاف التحقق بالصورة وبصمة الوجه والموقع للشركة أو لموظف واحد، والتحقق الفاشل يُنبَّه للمراجعة بدل الرفض.
  key: f82cad9 · commit: f82cad9 · dev: 2026-11-22 19:32Z
- [Attendance · New feature] Flexible hours and the monthly attendance report | ساعات العمل المرنة وتقرير الحضور الشهري
  Arrival between 08:30 and 09:15 with eight hours of work; a monthly PDF / Excel report, a compact By-person table, and each person's own attendance PDF. | الحضور بين 08:30 و09:15 مع ثماني ساعات عمل، وتقرير شهري PDF / Excel، وجدول مختصر حسب الموظف، وملف PDF لحضور كل موظف.
  key: 8ec3c77 · commit: 8ec3c77 · dev: 2026-11-22 19:13Z

## 2026-11-17
- [Verification · Fix] Face ID on iPhone opens at once and explains what to turn on | بصمة الوجه في الآيفون تفتح مباشرة وتوضح ما يجب تفعيله
  The Face ID prompt opens straight from the tap, and when the phone can't save the key it says which setting to turn on. | تفتح نافذة بصمة الوجه مباشرة عند الضغط، وعند تعذّر حفظ المفتاح توضح الإعداد المطلوب تفعيله.
  key: 4923ef2 · commit: 4923ef2 · dev: 2026-11-17 06:14Z

## 2026-11-16
- [Verification · New feature] Face ID / fingerprint at check-in | بصمة الوجه / الإصبع عند تسجيل الحضور
  Check-in asks for the phone's Face ID or fingerprint; HR can exempt a person. | يطلب تسجيل الحضور بصمة الوجه أو الإصبع في الهاتف، ويمكن للموارد البشرية إعفاء موظف.
  key: 5e9b8ab · commit: 5e9b8ab · dev: 2026-11-16 20:07Z
- [Profiles · Improvement] Passport reminders from six months before expiry | تذكير الجواز قبل انتهائه بستة أشهر
  key: a356fa5 · commit: a356fa5 · dev: 2026-11-16 19:14Z
- [General · Improvement] Notifications go only to the people responsible | الإشعارات تصل للمسؤولين فقط
  key: 21daf3d · commit: 21daf3d · dev: 2026-11-16 18:53Z

## 2026-11-10
- [Attendance · Fix] Check-in camera: no black picture, pop-ups close at once | كاميرا الحضور: لا صورة سوداء والنوافذ تُغلق مباشرة
  key: daef37b · commit: daef37b · dev: 2026-11-10 20:26Z

## 2026-11-09
- [Attendance · New feature] Check-in and check-out reminders | تذكير تسجيل الحضور والانصراف
  A reminder ten minutes after the shift starts or ends, set by Admin. | تذكير بعد عشر دقائق من بداية المناوبة أو نهايتها، يضبطه المسؤول.
  key: 78eb01b · commit: 78eb01b · dev: 2026-11-09 19:54Z

## 2026-11-08
- [Profiles · New feature] Report a mistake on any profile field | الإبلاغ عن خطأ في أي حقل من الملف
  Staff report a wrong value on their profile; Admin downloads one file of the reports and documents. | يبلّغ الموظف عن قيمة خاطئة في ملفه، ويُنزّل المسؤول ملفاً واحداً بالبلاغات والمستندات.
  key: 9886ac5 · commit: 9886ac5 · dev: 2026-11-08 09:02Z
- [Profiles · Fix] ID reader finishes an English family name cut short by the card | قارئ البطاقة يكمل اسم العائلة الإنجليزي المقطوع
  key: 13d5413 · commit: 13d5413 · dev: 2026-11-08 08:53Z

## 2026-11-05
- [Profiles · New feature] Read and update details from a document on file | قراءة وتحديث البيانات من مستند محفوظ
  “Read and update details” on a civil ID, passport or visa already on file, with feedback on each reading collected in one list. | زر «قراءة وتحديث البيانات» على البطاقة أو الجواز أو التأشيرة المحفوظة، مع جمع الملاحظات على كل قراءة في قائمة واحدة.
  key: 16535fb · commit: 16535fb · dev: 2026-11-05 16:49Z
- [Profiles · Fix] Arabic names read from PDF text, including family names with «عمان» | قراءة الأسماء العربية من نص PDF بما فيها أسماء العائلة التي فيها «عمان»
  key: 75f3cb4 · commit: 75f3cb4 · dev: 2026-11-05 16:28Z
- [Profiles · Improvement] Personal details from the civil ID only; check every profile against its documents | البيانات الشخصية من البطاقة المدنية فقط؛ ومطابقة كل ملف مع مستنداته
  key: 9dfc9e5 · commit: 9dfc9e5 · dev: 2026-11-05 16:02Z
- [Leave · New feature] HR assigns a direct manager who approves the person's requests | تعيين المدير المباشر الذي يعتمد طلبات الموظف
  key: a427dbc · commit: a427dbc · dev: 2026-11-05 13:12Z
- [Profiles · Improvement] Profile changes show the date and time and the document to compare | تحديثات الملف تعرض التاريخ والوقت والمستند للمقارنة
  key: b789a77 · commit: b789a77 · dev: 2026-11-05 10:40Z
- [Attendance · Improvement] HR's waiting list includes extra time after hours | قائمة انتظار الموارد البشرية تشمل الوقت الإضافي بعد الدوام
  key: ec58ec9 · commit: ec58ec9 · dev: 2026-11-05 08:44Z

## 2026-11-04
- [Leave · Improvement] Maternity leave for women only, paternity leave for men only | إجازة الأمومة للنساء فقط والأبوة للرجال فقط
  key: 13aa00e · commit: 13aa00e · dev: 2026-11-04 13:16Z
- [Leave · New feature] Umrah leave | إجازة العمرة
  From the annual balance, up to seven days once a year, with proof. | من الرصيد السنوي، حتى سبعة أيام مرة في السنة، مع الإثبات.
  key: 4dba741 · commit: 4dba741 · dev: 2026-11-04 09:58Z
- [Reports · New feature] Overtime pay report | تقرير أجر العمل الإضافي
  The overtime pay report, and time after official hours shown on the attendance sheet. | تقرير أجر العمل الإضافي، وعرض الوقت بعد الدوام الرسمي في كشف الحضور.
  key: 04b632e · commit: 04b632e · dev: 2026-11-04 07:54Z
- [Attendance · Fix] Online check-in from outside the office works on phones | تسجيل الحضور عن بُعد من خارج المكتب يعمل على الهواتف
  key: e41ed3c · commit: e41ed3c · dev: 2026-11-04 07:15Z

## 2026-11-03
- [General · Improvement] Ask to turn on notifications after sign-in | طلب تفعيل الإشعارات بعد الدخول
  key: bfb98da · commit: bfb98da · dev: 2026-11-03 03:46Z
- [Shifts · New feature] Shift 4: 10:00–18:00, assigned by HR / Admin | المناوبة 4: 10:00–18:00 بتعيين الموارد البشرية / المسؤول
  key: cf38548 · commit: cf38548 · dev: 2026-11-03 03:38Z
- [Calendar · Improvement] HR and Admin edit or remove the built-in national days | تعديل أو حذف المناسبات الوطنية المدمجة
  key: fabb1f8 · commit: fabb1f8 · dev: 2026-11-03 03:16Z
- [General · Improvement] Notifications page: the title first, then this device's setting | صفحة الإشعارات: العنوان أولاً ثم إعداد هذا الجهاز
  key: b65b724 · commit: b65b724 · dev: 2026-11-03 03:12Z

## 2026-11-02
- [Attendance · New feature] Forgotten check-outs, extra time after hours, pop-up notifications | الانصراف المنسي والوقت الإضافي بعد الدوام والإشعارات المنبثقة
  Staff are reminded of a forgotten check-out, can ask for extra time after hours, and get pop-up notifications on their phone; HR edits the calendar. | يُذكَّر الموظف بالانصراف المنسي، ويطلب وقتاً إضافياً بعد الدوام، وتصله إشعارات منبثقة على الهاتف، وتعدّل الموارد البشرية التقويم.
  key: be912a6 · commit: be912a6 · dev: 2026-11-02 21:37Z
- [Profiles · Fix] Expiry today asked first; emails typed on phones accepted | السؤال عن انتهاء اليوم أولاً؛ وقبول البريد المكتوب من الهاتف
  key: 12b009b · commit: 12b009b · dev: 2026-11-02 21:07Z

## 2026-11-01
- [General · Improvement] Faster on phones | أسرع على الهواتف
  The portal's files and small copies of photos are kept on the phone, and settings are read from memory. | تُحفظ ملفات البوابة ونسخ صغيرة من الصور على الهاتف، وتُقرأ الإعدادات من الذاكرة.
  key: 509d686 · commit: 509d686 · dev: 2026-11-01 21:02Z
- [Leave · New feature] Requests can go straight to the CEO, the Chairman or both | الطلبات مباشرة إلى الرئيس التنفيذي أو رئيس مجلس الإدارة أو كليهما
  key: d647fdf · commit: d647fdf · dev: 2026-11-01 20:22Z
- [Attendance · Fix] Today isn't judged before the shift ends | لا يُحكم على اليوم قبل نهاية المناوبة
  key: 0372157 · commit: 0372157 · dev: 2026-11-01 20:10Z
- [Reports · Improvement] Separate fingerprint and online attendance reports | تقارير منفصلة لحضور البصمة والحضور عن بُعد
  Separate reports and sheets for the fingerprint machine and online check-in, each keeping its own in / out label. | تقارير وكشوف منفصلة لجهاز البصمة والحضور عن بُعد، ولكل منها تسمية الدخول والخروج الخاصة به.
  key: 262a143 · commit: 262a143 · dev: 2026-11-01 20:02Z
- [Attendance · New feature] External tasks over several days with an automatic allowance | مهام خارجية لعدة أيام مع بدل تلقائي
  Multi-day external tasks, an automatic allowance, a monthly allowance report, and setting a balance to an exact number. | مهام خارجية لعدة أيام، وبدل تلقائي، وتقرير شهري للبدلات، وضبط الرصيد على رقم محدد.
  key: 5fc803a · commit: 5fc803a · dev: 2026-11-01 19:39Z
- [Attendance · Improvement] Online check-in log and a clearer “My attendance” | سجل الحضور عن بُعد و«حضوري» أوضح
  key: af053c3 · commit: af053c3 · dev: 2026-11-01 19:19Z
- [Leave · Improvement] Leave approval in two steps: the direct manager, then HR | اعتماد الإجازة على مرحلتين: المدير المباشر ثم الموارد البشرية
  key: 85bdfe4 · commit: 85bdfe4 · dev: 2026-11-01 13:47Z
- [General · Improvement] Phone bar shows Approvals with its count | شريط الهاتف يعرض الموافقات مع عددها
  key: 1892084 · commit: 1892084 · dev: 2026-11-01 13:35Z

## 2026-10-31
- [General · Improvement] Phone layout polish | تحسينات عرض الهاتف
  Two tiles per row on small phones, a shorter leave list, and check-in approval shown. | مربعان في كل صف على الهواتف الصغيرة، وقائمة إجازات أقصر، وعرض موافقة الحضور.
  key: cd2fd32 · commit: cd2fd32 · dev: 2026-10-31 21:19Z
- [Profiles · Improvement] Age worked out from the date of birth | حساب العمر من تاريخ الميلاد
  key: 4129b20 · commit: 4129b20 · dev: 2026-10-31 20:00Z
- [Profiles · Improvement] Admin edits every section of their own profile in place | المسؤول يعدّل كل أقسام ملفه مباشرة
  key: 1dee382 · commit: 1dee382 · dev: 2026-10-31 19:56Z
- [Profiles · Fix] Nationality for every country, read from the printed line | الجنسية لكل الدول وقراءتها من السطر المطبوع
  key: b220041 · commit: b220041 · dev: 2026-10-31 19:51Z
- [Profiles · Improvement] “Reading the document…” while an ID or passport is read | نافذة «جارٍ قراءة المستند…» أثناء قراءة البطاقة أو الجواز
  key: 4cbc6fd · commit: 4cbc6fd · dev: 2026-10-31 19:46Z
- [Profiles · Fix] The Arabic name reads through the card's security background | قراءة الاسم العربي رغم خلفية البطاقة الأمنية
  key: 556bae6 · commit: 556bae6 · dev: 2026-10-31 19:30Z
- [Attendance · New feature] Check-in outside the sites needs manager approval | الحضور خارج المواقع يحتاج موافقة المدير
  Outside the work sites a check-in waits for the manager; the sign-in location is kept; a site can be added from a Google Maps link. | الحضور خارج مواقع العمل ينتظر موافقة المدير، ويُحفظ موقع الدخول، ويمكن إضافة موقع من رابط خرائط جوجل.
  key: 9c9d900 · commit: 9c9d900 · dev: 2026-10-31 10:05Z
- [Attendance · New feature] Online check-in and check-out from the portal | تسجيل الحضور والانصراف عن بُعد من البوابة
  With location, a live photo, work sites and a 15-minute grace period. | مع الموقع وصورة مباشرة ومواقع العمل ومهلة 15 دقيقة.
  key: c0eaa31 · commit: c0eaa31 · dev: 2026-10-31 09:51Z

## 2026-10-30
- [Profiles · Fix] ID reader: phone-scanned PDFs read the printed name | قارئ البطاقة: قراءة الاسم المطبوع من ملفات PDF الممسوحة بالهاتف
  key: 424ae1f · commit: 424ae1f · dev: 2026-10-30 23:15Z
- [General · Improvement] Noto Kufi Arabic font across the portal | خط Noto Kufi Arabic في كل البوابة
  key: 5ae3561 · commit: 5ae3561 · dev: 2026-10-30 22:50Z
- [Profiles · New feature] Review an ID or passport reading before saving | مراجعة قراءة البطاقة أو الجواز قبل الحفظ
  Each value is shown before and after; anything the scanner misread can be unticked. | تُعرض كل قيمة قبل وبعد، ويمكن إلغاء ما أخطأ الماسح في قراءته.
  key: 989e984 · commit: 989e984 · dev: 2026-10-30 22:40Z
- [Profiles · Improvement] Profile photo opens full size, with Download | صورة الملف تفتح بالحجم الكامل مع التنزيل
  key: 17e16a9 · commit: 17e16a9 · dev: 2026-10-30 22:25Z
- [Profiles · Improvement] Contract card: join date, probation end, length of service, contract type and end | بطاقة العقد: تاريخ التعيين ونهاية التجربة ومدة الخدمة ونوع العقد ونهايته
  key: 24dae4c · commit: 24dae4c · dev: 2026-10-30 22:09Z
- [Profiles · Improvement] Profile updates: a Delete button next to Undo | تحديثات الملف: زر حذف بجانب التراجع
  key: 2e95e47 · commit: 2e95e47 · dev: 2026-10-30 22:12Z
- [Leave · Improvement] Emergency leave is no longer offered | إلغاء خيار الإجازة الطارئة
  key: 322391e · commit: 322391e · dev: 2026-10-30 22:04Z

## 2026-10-28
- [General · New feature] CEO, Chairman and Consultant roles | أدوار الرئيس التنفيذي ورئيس مجلس الإدارة والمستشار
  Top management with reporting lines and authority; a read-only Consultant role that ends with the contract; a Management department approved by the CEO; Employee Voice to the Chairman. | الإدارة العليا بخطوط التبعية والصلاحيات، ودور مستشار للاطلاع فقط ينتهي بانتهاء العقد، وقسم الإدارة يعتمده الرئيس التنفيذي، وصوت الموظف إلى رئيس مجلس الإدارة.
  key: 9bc6b0d · commit: 9bc6b0d · dev: 2026-10-28 21:37Z
- [Profiles · New feature] Renew an expired ID, passport or visa | تجديد البطاقة أو الجواز أو التأشيرة المنتهية
  The old copy is archived for HR and Admin. | تُؤرشف النسخة القديمة للموارد البشرية والمسؤول.
  key: 23d114a · commit: 23d114a · dev: 2026-10-28 20:45Z
- [Profiles · New feature] Staff list sorted by any column | ترتيب قائمة الموظفين حسب أي عمود
  key: d60f615 · commit: d60f615 · dev: 2026-10-28 20:29Z
- [Profiles · Improvement] ID card: full English name and the Arabic name from the front | البطاقة: الاسم الإنجليزي كاملاً والاسم العربي من الوجه الأمامي
  The name in the right order, the full English name when the card cuts it, the Arabic name even without a label or broken over lines; every profile can be updated from its ID and passport in one go. | الاسم بالترتيب الصحيح، والاسم الإنجليزي كاملاً عند قطعه، والاسم العربي حتى بلا عنوان أو على عدة أسطر، وتحديث كل الملفات من بطاقاتها وجوازاتها دفعة واحدة.
  key: 37e514c · commit: 633a5ef · dev: 2026-10-28 20:35Z
- [Profiles · Improvement] ID and passport uploads update the personal details at once | رفع البطاقة والجواز يحدّث البيانات الشخصية مباشرة
  key: eae5462 · commit: eae5462 · dev: 2026-10-28 19:55Z
- [Profiles · Improvement] Profile in English or Arabic: each field in its own language | الملف بالإنجليزية أو العربية: كل حقل بلغته
  key: edb1c60 · commit: edb1c60 · dev: 2026-10-28 19:46Z
- [Profiles · Improvement] Documents grouped by type; Resume and Course certificate added | المستندات مجمّعة حسب النوع؛ إضافة السيرة الذاتية وشهادة الدورة
  key: 9ac0a76 · commit: 9ac0a76 · dev: 2026-10-28 19:40Z
- [Attendance · New feature] External work task | مهمة عمل خارجية
  An external work task can be requested from the permission screens and the home page. | يمكن طلب مهمة عمل خارجية من شاشات الاستئذان والصفحة الرئيسية.
  key: e80fe32 · commit: e80fe32 · dev: 2026-10-28 13:00Z
- [General · Improvement] Phone layout: month on one row, Save / Cancel pinned in long forms | عرض الهاتف: الشهر في صف واحد وأزرار الحفظ والإلغاء ثابتة
  key: cc74146 · commit: cc74146 · dev: 2026-10-28 12:14Z
- [Calendar · New feature] National and religious occasions and official holidays | المناسبات الوطنية والدينية والعطل الرسمية
  Oman's national days every year, religious occasions, the expected official holidays for a year (Royal Decree 88/2022), and staff events, personal or shared. | الأيام الوطنية لعُمان كل سنة، والمناسبات الدينية، والعطل الرسمية المتوقعة لسنة (المرسوم السلطاني 88/2022)، ومناسبات الموظفين الشخصية أو المشتركة.
  key: b8b12aa · commit: dffda98 · dev: 2026-10-28 12:02Z
- [Profiles · New feature] Read passports, IDs and visas, including PDFs | قراءة الجوازات والبطاقات والتأشيرات بما فيها ملفات PDF
  Expiry dates and numbers are read from the document; a new ID or passport updates the profile and differences are asked about; “View” opens a document in a pop-up. | تُقرأ تواريخ الانتهاء والأرقام من المستند، وتحدّث البطاقة أو الجواز الجديد الملف ويُسأل عن الفروقات، وزر «عرض» يفتح المستند في نافذة.
  key: 7d05ece · commit: 5207192 · dev: 2026-10-28 10:54Z
- [Profiles · New feature] Staff keep their profile current; HR verifies each change | الموظف يحدّث ملفه والموارد البشرية تتحقق من كل تغيير
  With the permanent address (wilayat) and the current area in Muscat. | مع العنوان الدائم (الولاية) والمنطقة الحالية في مسقط.
  key: a3006e9 · commit: 172ea5b · dev: 2026-10-28 10:03Z
- [Backup · New feature] Full backup with documents, and restore | نسخة احتياطية كاملة مع المستندات والاستعادة
  key: 4241af9 · commit: 4241af9 · dev: 2026-10-28 09:24Z
- [Profiles · Improvement] “Change password” on my profile; My profile last in the menu | «تغيير كلمة المرور» في ملفي؛ وملفي آخر القائمة
  key: 8b2a47d · commit: 8b2a47d · dev: 2026-10-28 08:40Z

## 2026-10-27
- [Shifts · New feature] Special shift 3 (10:00–17:00), assigned by HR / Admin | المناوبة الخاصة 3 (10:00–17:00) بتعيين الموارد البشرية / المسؤول
  key: 6bd3f78 · commit: 6bd3f78 · dev: 2026-10-27 22:07Z
- [Shifts · New feature] Staff choose their own shift from their profile | الموظف يختار مناوبته من ملفه
  key: 779a660 · commit: 779a660 · dev: 2026-10-27 21:57Z
- [Attendance · New feature] Fingerprint upload, monthly sheet and reports | رفع بيانات البصمة والكشف الشهري والتقارير
  Following attendance policy 007/2026. | وفق سياسة الحضور 007/2026.
  key: 2705b53 · commit: 2705b53 · dev: 2026-10-27 21:18Z
- [Profiles · New feature] Reset a password from the staff profile | إعادة تعيين كلمة المرور من ملف الموظف
  Admin and HR can reset a password, or type the new one, from the top of the profile. | يمكن للمسؤول والموارد البشرية إعادة تعيين كلمة المرور أو كتابة الجديدة من أعلى الملف.
  key: 734ec01 · commit: dbfe955 · dev: 2026-10-27 10:50Z

## 2026-10-26
- [Calendar · New feature] Company calendar | تقويم الشركة
  A month grid with blocked days, occasions, holidays and birthdays, and the team's leave. | شبكة شهرية بالأيام المحظورة والمناسبات والعطل وأعياد الميلاد وإجازات الفريق.
  key: a5abb68 · commit: a5abb68 · dev: 2026-10-26 22:05Z
- [Profiles · New feature] Profiles in one language, with Arabic and English boxes | الملفات بلغة واحدة مع خانات عربية وإنجليزية
  key: 20c1bb6 · commit: 20c1bb6 · dev: 2026-10-26 22:17Z
- [Profiles · New feature] Disable, enable or delete a staff record; Manager role | تعطيل أو تفعيل أو حذف سجل موظف؛ ودور المدير
  key: a79f19d · commit: a79f19d · dev: 2026-10-26 21:50Z
- [General · New feature] Light / dark switch next to the language button | زر الوضع الفاتح / الداكن بجانب زر اللغة
  key: 0fb0a08 · commit: 0fb0a08 · dev: 2026-10-26 21:40Z
- [Leave · Improvement] My leave and permissions: summary, year / month filter and history | إجازاتي واستئذاناتي: الملخص والتصفية بالسنة والشهر والسجل
  key: 7e744bf · commit: fce68e9 · dev: 2026-10-26 21:23Z
- [General · New feature] Staff Voice | صوت الموظف
  Suggestions, questions, complaints and notes to management; Admin can hide or delete messages. | اقتراحات وأسئلة وشكاوى وملاحظات للإدارة، ويمكن للمسؤول إخفاء الرسائل أو حذفها.
  key: d84c596 · commit: d84c596 · dev: 2026-10-26 21:00Z
- [Permissions · New feature] Permission requests: early leave, late arrival, personal break | طلبات الاستئذان: خروج مبكر وتأخير واستراحة شخصية
  With a report, and staff update their own photo and contact details. | مع تقرير، ويحدّث الموظف صورته وبيانات التواصل.
  key: d2b5769 · commit: d2b5769 · dev: 2026-10-26 20:39Z
- [Profiles · New feature] Read ID cards and passports on our own server; expiry alerts | قراءة البطاقات والجوازات على خادمنا؛ وتنبيهات الانتهاء
  key: 9ef7618 · commit: 9ef7618 · dev: 2026-10-26 20:21Z
- [General · Fix] Fits every phone and tablet, iOS and Android | يناسب كل الهواتف والأجهزة اللوحية iOS وAndroid
  key: ae0fa7a · commit: ae0fa7a · dev: 2026-10-26 19:15Z
- [Profiles · New feature] Nationality list, document upload with ID scan, holiday calendar | قائمة الجنسيات ورفع المستندات مع قراءة البطاقة وتقويم العطل
  key: 0d8df20 · commit: 0d8df20 · dev: 2026-10-26 18:57Z
- [Leave · New feature] Approver cover and the team leave calendar | البديل عن المعتمد وتقويم إجازات الفريق
  Approvers name a deputy for their own leave; legal limits can't be bypassed. | يحدد المعتمد بديلاً أثناء إجازته، ولا يمكن تجاوز الحدود القانونية.
  key: 7b0b5d1 · commit: ea37e40 · dev: 2026-10-26 16:00Z
- [Leave · New feature] Leave follows the Oman Labour Law and Nama's policies | الإجازات وفق قانون العمل العُماني وسياسات نماء
  Royal Decree 53/2023; holidays not deducted, early-leave allowance and the holiday-work choice. | المرسوم السلطاني 53/2023؛ العطل لا تُخصم، وسماحية الخروج المبكر، وخيار العمل في العطل.
  key: 728161f · commit: b6474d3 · dev: 2026-10-26 15:24Z
- [Profiles · Improvement] Qualifications on profiles; import of the direct manager and departments | المؤهلات في الملفات؛ واستيراد المدير المباشر والأقسام
  key: 912af67 · commit: 912af67 · dev: 2026-10-26 12:32Z
- [Leave · New feature] Leave requests, approvals, balances and notifications | طلبات الإجازة والموافقات والأرصدة والإشعارات
  Staff ask for leave in the portal and their approver decides; yearly credits, document expiry alerts and backups run by themselves. | يطلب الموظف الإجازة من البوابة ويقرر المعتمد، وتُضاف الأرصدة السنوية وتنبيهات انتهاء المستندات والنسخ الاحتياطية تلقائياً.
  key: b2cbf0f · commit: fd75b56 · dev: 2026-10-26 11:43Z
- [Profiles · New feature] HR portal launched: sign-in, staff profiles and import | إطلاق بوابة الموارد البشرية: الدخول وملفات الموظفين والاستيراد
  Staff sign in; HR keeps profiles, departments and documents and imports the existing staff sheet. | يدخل الموظفون إلى البوابة، وتدير الموارد البشرية الملفات والأقسام والمستندات وتستورد ملف الموظفين الحالي.
  key: 3fe185d · commit: 3fe185d · dev: 2026-10-26 11:31Z
