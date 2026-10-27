// Every UI string, Arabic first. t("key", {n: 3}) fills {n}.
const D = {
  app_name: ["الموارد البشرية", "Human Resources"],
  company: ["نماء العقارية", "Nama Real Estate"],
  lang_toggle: ["English", "العربية"],
  // auth
  username: ["اسم المستخدم", "Username"], password: ["كلمة المرور", "Password"], sign_in: ["تسجيل الدخول", "Sign in"],
  sign_out: ["تسجيل الخروج", "Sign out"], signing_in: ["جارٍ الدخول…", "Signing in…"],
  bad_credentials: ["اسم المستخدم أو كلمة المرور غير صحيحة", "Wrong username or password"],
  locked: ["محاولات كثيرة. حاول بعد ١٠ دقائق.", "Too many attempts. Try again in 10 minutes."],
  choose_password: ["اختر كلمة مرور جديدة", "Choose a new password"],
  choose_password_sub: ["لأمان حسابك، اختر كلمة مرور خاصة بك (٨ أحرف على الأقل).", "For your security, choose your own password (at least 8 characters)."],
  current_password: ["كلمة المرور الحالية", "Current password"], new_password: ["كلمة المرور الجديدة", "New password"],
  confirm_password: ["تأكيد كلمة المرور", "Confirm password"], passwords_differ: ["كلمتا المرور غير متطابقتين", "Passwords do not match"],
  save_password: ["حفظ كلمة المرور", "Save password"], password_saved: ["تم حفظ كلمة المرور", "Password saved"],
  change_password: ["تغيير كلمة المرور", "Change password"],
  // nav
  nav_home: ["الرئيسية", "Home"], nav_me: ["ملفي", "My profile"], nav_leave: ["إجازاتي", "My leave"], nav_apply: ["طلب جديد", "New request"],
  nav_approvals: ["الموافقات", "Approvals"], nav_staff: ["الموظفون", "Staff"], nav_requests: ["كل الطلبات", "All requests"],
  nav_import: ["استيراد Excel", "Excel import"], nav_settings: ["الإعدادات", "Settings"], nav_users: ["المستخدمون", "Users"],
  nav_audit: ["سجل التغييرات", "Audit log"], nav_notifications: ["الإشعارات", "Notifications"], nav_more: ["المزيد", "More"],
  dev_badge: ["تجريبي", "DEV"],
  // common
  save: ["حفظ", "Save"], cancel: ["إلغاء", "Cancel"], back: ["رجوع", "Back"], edit: ["تعديل", "Edit"], delete: ["حذف", "Delete"],
  close: ["إغلاق", "Close"], confirm: ["تأكيد", "Confirm"], search: ["بحث", "Search"], all: ["الكل", "All"], none: ["—", "—"],
  loading: ["جارٍ التحميل…", "Loading…"], saved: ["تم الحفظ", "Saved"], error: ["حدث خطأ", "Something went wrong"],
  offline: ["تعذر الاتصال بالخادم", "Cannot reach the server"], required: ["مطلوب", "Required"], optional: ["اختياري", "Optional"],
  days: ["{n} يوم", "{n} days"], day_one: ["يوم واحد", "1 day"], hours: ["{n} ساعة", "{n} h"],
  yes: ["نعم", "Yes"], no: ["لا", "No"], download: ["تنزيل", "Download"], open: ["فتح", "Open"], view_all: ["عرض الكل", "View all"],
  no_results: ["لا توجد نتائج", "Nothing here yet"], forbidden: ["ليست لديك صلاحية", "You do not have permission"], not_found: ["غير موجود", "Not found"],
  // roles & statuses
  role_staff: ["موظف", "Staff"], role_hr: ["مدير الموارد البشرية", "HR Manager"], role_accounts: ["الحسابات", "Accounts"],
  role_ceo: ["الرئيس التنفيذي", "CEO"], role_admin: ["مدير النظام", "Admin"], role_manager: ["مدير", "Manager"],
  st_active: ["على رأس العمل", "Active"], st_on_leave: ["في إجازة", "On leave"], st_resigned: ["مستقيل", "Resigned"], st_terminated: ["منتهي الخدمة", "Terminated"],
  rs_pending: ["بانتظار الموافقة", "Pending"], rs_approved: ["موافق عليه", "Approved"], rs_rejected: ["مرفوض", "Rejected"], rs_cancelled: ["ملغى", "Cancelled"],
  ev_submitted: ["قدّم الطلب", "Submitted"], ev_approved: ["وافق", "Approved"], ev_rejected: ["رفض", "Rejected"], ev_cancelled: ["ألغى", "Cancelled"],
  // leave types
  lt_annual: ["إجازة سنوية", "Annual leave"], lt_early: ["مغادرة مبكرة", "Early leave"], lt_emergency: ["إجازة اضطرارية", "Emergency leave"],
  lt_bereavement: ["إجازة وفاة", "Bereavement leave"], lt_sick: ["إجازة مرضية", "Sick leave"], lt_comp_day: ["عمل في يوم عطلة", "Worked on a holiday"],
  lt_marriage: ["إجازة زواج", "Marriage leave"], lt_paternity: ["إجازة أبوة", "Paternity leave"], lt_maternity: ["إجازة أمومة", "Maternity leave"],
  lt_hajj: ["إجازة الحج", "Hajj leave"], lt_exam: ["إجازة امتحانات", "Exam leave"], lt_patient_care: ["مرافقة مريض", "Accompanying a patient"],
  lt_childcare: ["رعاية طفل (بدون أجر)", "Child care (unpaid)"], lt_unpaid: ["إجازة خاصة بدون أجر", "Special unpaid leave"],
  grp_main: ["الإجازات الأساسية", "Main"], grp_special: ["إجازات خاصة بأجر (المادة ٨٤)", "Special paid leave (Art. 84)"], grp_unpaid: ["بدون أجر", "Unpaid"],
  rule_annual: ["٣٠ يوماً سنوياً بعد ٦ أشهر من التعيين (المادة ٧٨).", "30 days a year, after 6 months of service (Art. 78)."],
  rule_early: ["أول {n} ساعات في الشهر مجانية، وما زاد يُخصم من الإجازة السنوية (٨ ساعات = يوم).", "The first {n} hours each month are free; extra hours come from annual leave (8 h = 1 day)."],
  rule_emergency: ["تُخصم من رصيد الإجازة السنوية (سياسة الشركة).", "Taken from your annual leave balance (company policy)."],
  comp_choice: ["التعويض", "Compensation"], comp_leave: ["يوم إجازة (+١ يوم للرصيد)", "A day off (+1 day to the balance)"], comp_pay: ["مقابل مالي (يُسجل للرواتب)", "Payment (recorded for payroll)"],
  deducted_from_annual: ["خُصم من الإجازة السنوية", "Taken from annual leave"], holidays_excluded: ["لا تُحتسب العطلات الرسمية داخل الإجازة", "Official holidays inside the leave are not counted"],
  official_holidays: ["العطلات الرسمية", "Official holidays"], official_holidays_hint: ["سطر لكل عطلة: التاريخ ثم الاسم، مثل 2026-11-18 اليوم الوطني", "One per line: date then name, e.g. 2026-11-18 National Day"],
  early_free_hours: ["ساعات المغادرة المجانية شهرياً", "Free early-leave hours per month"], lk_emergency_leave: ["إجازة اضطرارية", "Emergency leave"],
  rule_sick: ["حتى ١٨٢ يوماً في السنة بشهادة طبية (المادتان ٤٧ و٨٢).", "Up to 182 days a year with a medical certificate (Art. 47, 82)."],
  rule_bereavement: ["حسب صلة القرابة (المادة ٨٤).", "Depends on the relation (Art. 84)."],
  rule_marriage: ["٣ أيام، مرة واحدة طوال الخدمة.", "3 days, once during your service."],
  rule_paternity: ["٧ أيام قبل أن يبلغ الطفل ٩٨ يوماً.", "7 days, before the child is 98 days old."],
  rule_maternity: ["٩٨ يوماً، منها ١٤ يوماً كحد أقصى قبل الولادة.", "98 days; at most 14 of them before the birth."],
  rule_hajj: ["١٥ يوماً مرة واحدة بعد سنة متصلة في الخدمة.", "15 days once, after a continuous year of service."],
  rule_exam: ["حتى ١٥ يوماً في السنة للعاملين العمانيين الدارسين.", "Up to 15 days a year for Omani staff who study."],
  rule_patient_care: ["حتى ١٥ يوماً في السنة للعاملين العمانيين لمرافقة الزوج أو قريب حتى الدرجة الثانية.", "Up to 15 days a year for Omani staff, for a spouse or relative up to the 2nd degree."],
  rule_childcare: ["حتى سنة بدون أجر للعاملة (المادة ٨٣).", "Up to 1 year without wage for a working mother (Art. 83)."],
  rule_unpaid: ["بموافقة صاحب العمل، بدون أجر (المادة ٨٠).", "At the employer's discretion, without wage (Art. 80)."],
  rule_comp_day: ["يُضاف يوم واحد إلى رصيدك بعد الموافقة.", "One day is added to your balance once approved."],
  up_to: ["حتى {n}", "Up to {n}"], max_allowed: ["الحد المسموح", "Maximum allowed"],
  cover_title: ["النائب أثناء غيابي", "Cover while I'm away"], cover_hint: ["خلال هذه الفترة تذهب الطلبات الجديدة إلى النائب، ويمكنه البت في الطلبات المنتظرة.", "During these dates new requests go to your deputy, who can also decide waiting ones."],
  deputy: ["النائب", "Deputy"], add_cover: ["تعيين نائب", "Set deputy"], covering_for: ["تنوب عن {name}", "Covering for {name}"], route_cover: ["النائب", "Deputy"],
  nav_calendar: ["التقويم", "Calendar"], calendar_none: ["لا أحد في إجازة هذا الشهر", "Nobody is off this month"], prev_month: ["الشهر السابق", "Previous month"], next_month: ["الشهر التالي", "Next month"],
  off_count: ["{n} في إجازة", "{n} off"], holiday: ["عطلة رسمية", "Official holiday"],
  relation: ["صلة القرابة", "Relation"], patient_relation: ["صلة القرابة بالمريض", "Relation to the patient"], birth_date: ["تاريخ الولادة (أو المتوقع)", "Date of birth (or expected)"],
  rel_wife: ["الزوجة", "Wife"], rel_son: ["الابن", "Son"], rel_daughter: ["البنت", "Daughter"], rel_father: ["الأب", "Father"], rel_mother: ["الأم", "Mother"],
  rel_grandfather: ["الجد", "Grandfather"], rel_grandmother: ["الجدة", "Grandmother"], rel_brother: ["الأخ", "Brother"], rel_sister: ["الأخت", "Sister"],
  rel_uncle: ["العم أو الخال", "Uncle"], rel_aunt: ["العمة أو الخالة", "Aunt"], rel_husband_muslim: ["الزوج (عدة المسلمة)", "Husband (Muslim widow)"], rel_husband_other: ["الزوج (غير المسلمة)", "Husband (non-Muslim widow)"],
  proof: ["المستند المؤيد", "Supporting document"], proof_needed: ["يجب إرفاق المستند المؤيد قبل الموافقة.", "A supporting document must be attached before approval."],
  proof_missing: ["بدون مستند", "No document"], attach_proof: ["إرفاق مستند", "Attach document"], unpaid_note: ["بدون أجر", "Without wage"],
  sick_pay: ["أجر الإجازة المرضية (المادة ٨٢)", "Sick-leave pay (Art. 82)"], pay_pct: ["{p}٪ من الأجر", "{p}% of wage"],
  postpone: ["تأجيل", "Postpone"], postpone_to: ["تاريخ البدء الجديد (حتى ٦ أشهر)", "New start date (up to 6 months)"], postponed_ok: ["تم التأجيل والموافقة", "Postponed and approved"],
  ev_postponed: ["أجّل ووافق", "Postponed and approved"],
  f_gender: ["الجنس", "Gender"], g_male: ["ذكر", "Male"], g_female: ["أنثى", "Female"],
  encash: ["صرف نقدي للرصيد", "Pay leave in cash"], encash_days: ["عدد الأيام", "Days"], consent_doc: ["موافقة الموظف الكتابية", "Employee's written consent"],
  encash_note: ["بالأجر الأساسي وبموافقة كتابية من الموظف (المادة ٨١). ارفع الموافقة أولاً كمستند من نوع «موافقة».", "At the basic wage, with the employee's written consent (Art. 81). Upload the consent first as a document of type “Consent”."],
  dt_consent: ["موافقة كتابية", "Written consent"], lk_encashment: ["صرف نقدي", "Paid in cash"],
  nav_cap_reviews: ["مراجعة الأرصدة", "Balance reviews"], cap_reviews_title: ["أرصدة تتجاوز ٦٠ يوماً", "Balances over 60 days"],
  cap_reviews_note: ["يحتفظ العامل برصيد حتى ٣٠ يوماً، إلا إذا كان عدم الانتفاع بالإجازة لمصلحة العمل فيُحتفظ به كاملاً (المادة ٧٨). لا يسقط أي يوم تلقائياً.", "A worker may keep up to 30 days, unless leave wasn't taken because of the work, in which case all of it is kept (Art. 78). Nothing is forfeited automatically."],
  excess: ["الزائد", "Over the cap"], keep_work: ["احتفاظ — لمصلحة العمل", "Keep — work needs"], forfeit: ["إسقاط", "Forfeit"],
  decision_reason: ["سبب القرار (مطلوب)", "Reason for the decision (required)"], rv_pending: ["بانتظار القرار", "Pending"], rv_kept: ["تم الاحتفاظ", "Kept"], rv_forfeited: ["أُسقط", "Forfeited"],
  under_30_title: ["لم يأخذوا ٣٠ يوماً خلال سنتين", "Haven't taken 30 days in 2 years"], pending_reviews: ["أرصدة بحاجة لقرار", "Balances to review"],
  work_day_end: ["نهاية الدوام", "End of working day"], ramadan: ["دوام شهر رمضان", "Ramadan hours"], ramadan_start: ["بداية رمضان", "Ramadan starts"],
  ramadan_end: ["نهاية رمضان", "Ramadan ends"], ramadan_day_end: ["نهاية الدوام في رمضان", "End of day in Ramadan"],
  ramadan_hint: ["٦ ساعات يومياً للعاملين المسلمين (المادة ٧٠). تُحسب المغادرة المبكرة حتى هذا الوقت.", "6 hours a day for Muslim workers (Art. 70). Early leave is measured to this time."],
  lt_record_note: ["لا تُخصم من رصيد الإجازة السنوية.", "Does not affect your annual leave balance."],
  lt_comp_note: ["يُضاف يوم واحد إلى رصيدك بعد الموافقة.", "One day is added to your balance once approved."],
  // balance
  bal_remaining: ["الرصيد المتبقي", "Remaining"], bal_available: ["المتاح للطلب", "Available to request"], bal_entitlement: ["استحقاق السنة", "This year's entitlement"],
  bal_carried: ["مُرحّل", "Carried over"], bal_used: ["المستخدم", "Used"], bal_pending: ["قيد الموافقة", "Pending"], bal_extra: ["أيام إضافية", "Extra days"],
  bal_adjustments: ["تعديلات", "Adjustments"], leave_year: ["سنة الإجازة من {d}", "Leave year from {d}"],
  eligible_from: ["يمكنك طلب الإجازة السنوية والمغادرة من {d}", "You can request annual and early leave from {d}"],
  probation_end: ["نهاية فترة التجربة", "Probation ends"], no_join_date: ["تاريخ التعيين غير مسجل", "Join date not recorded"],
  by_type: ["حسب النوع هذه السنة", "By type this year"],
  // home
  hello: ["مرحباً {name}", "Hello {name}"], apply_leave: ["طلب إجازة", "Apply for leave"], recent_requests: ["آخر الطلبات", "Recent requests"],
  pending_approvals: ["طلبات بانتظار موافقتك", "Requests awaiting your approval"], staff_count: ["الموظفون على رأس العمل", "Active staff"],
  ids_expiring: ["مستندات تنتهي خلال 30 يوماً", "Documents expiring in 30 days"], all_pending: ["طلبات قيد الموافقة", "Pending requests"],
  needs_attention: ["بحاجة لاستكمال", "Needs attention"], missing_join: ["بدون تاريخ تعيين", "Missing join date"],
  no_profile: ["حسابك غير مرتبط بملف موظف.", "Your login is not linked to a staff profile."],
  // staff list / profile
  staff_title: ["الموظفون", "Staff"], add_employee: ["إضافة موظف", "Add employee"], filter_dept: ["القسم", "Department"], filter_status: ["الحالة", "Status"],
  sec_personal: ["البيانات الشخصية", "Personal"], sec_contact: ["التواصل", "Contact"], sec_job: ["الوظيفة", "Job"], sec_contract: ["العقد", "Contract"],
  sec_documents: ["المستندات", "Documents"], sec_leave: ["الإجازات", "Leave"], sec_kpi: ["مؤشرات الأداء", "KPIs"],
  kpi_later: ["سيتوفر في مرحلة لاحقة", "Coming in a later phase"], sec_ledger: ["حركة الرصيد", "Balance history"], sec_requests: ["سجل الطلبات", "Request history"],
  f_name_ar: ["الاسم بالعربية", "Name (Arabic)"], f_name_en: ["الاسم بالإنجليزية", "Name (English)"], f_emp_no: ["الرقم الوظيفي", "Employee ID"],
  f_emp_no_hint: ["اتركه فارغاً لإنشائه تلقائياً", "Leave empty to generate"], f_photo: ["الصورة", "Photo"],
  f_civil_id: ["الرقم المدني", "Civil ID"], f_civil_id_expiry: ["انتهاء البطاقة المدنية", "Civil ID expiry"], f_nationality: ["الجنسية", "Nationality"],
  f_dob: ["تاريخ الميلاد", "Date of birth"], f_mobile: ["الهاتف", "Mobile"], f_email: ["البريد الإلكتروني", "Email"], f_address: ["العنوان", "Address"],
  f_emergency_name: ["جهة الاتصال للطوارئ", "Emergency contact"], f_emergency_relation: ["صلة القرابة", "Relationship"], f_emergency_phone: ["هاتف الطوارئ", "Emergency phone"],
  f_department_id: ["القسم", "Department"], f_department: ["القسم", "Department"], f_job_title: ["المسمى الوظيفي", "Job title"], f_manager_employee_id: ["المدير المباشر", "Direct manager"],
  f_join_date: ["تاريخ التعيين", "Join date"], f_contract_type: ["نوع العقد", "Contract type"], f_contract_end: ["نهاية العقد", "Contract end"],
  f_status: ["الحالة", "Status"], f_opening_days: ["الرصيد الافتتاحي (أيام)", "Opening balance (days)"],
  f_opening_hint: ["للموظفين الحاليين: الرصيد المتبقي اليوم. اتركه فارغاً لإضافة ٣٠ يوماً.", "For existing staff: today's remaining balance. Leave empty to credit 30 days."],
  sec_qualifications: ["المؤهلات والخبرات", "Qualifications"], f_education: ["أعلى مؤهل علمي", "Highest qualification"],
  f_specialization: ["التخصص", "Specialization"], f_experience: ["سنوات الخبرة", "Years of experience"], f_languages: ["اللغات", "Languages"],
  f_skills: ["المهارات", "Key skills"], f_certifications: ["الدورات والشهادات", "Courses & certifications"], f_main_tasks: ["المهام الرئيسية", "Main tasks"],
  f_manager: ["المدير المباشر (رقم أو اسم)", "Direct manager (ID or name)"],
  login_account: ["حساب الدخول", "Login"], create_login: ["إنشاء حساب دخول", "Create login"], no_login: ["لا يوجد حساب دخول", "No login yet"],
  temp_password_title: ["كلمة مرور مؤقتة", "One-time password"],
  temp_password_note: ["أعطها للموظف. ستظهر مرة واحدة فقط وسيُطلب منه تغييرها عند الدخول.", "Give it to the employee. It is shown only once and must be changed at first sign-in."],
  adjust_balance: ["تعديل الرصيد", "Adjust balance"], adjust_amount: ["المقدار", "Amount"], adjust_add: ["إضافة", "Add"], adjust_deduct: ["خصم", "Deduct"],
  adjust_unit_days: ["أيام", "Days"], adjust_unit_hours: ["ساعات", "Hours"], adjust_reason: ["السبب (مطلوب)", "Reason (required)"],
  upload_document: ["رفع مستند", "Upload document"], doc_type: ["نوع المستند", "Document type"], doc_expiry: ["تاريخ الانتهاء", "Expiry"],
  dt_civil_id: ["البطاقة المدنية", "Civil ID"], dt_passport: ["جواز السفر", "Passport"], dt_contract: ["العقد", "Contract"], dt_visa: ["التأشيرة", "Visa"],
  dt_certificate: ["شهادة", "Certificate"], dt_medical: ["تقرير طبي", "Medical note"], dt_other: ["أخرى", "Other"],
  change_photo: ["تغيير الصورة", "Change photo"], delete_file_q: ["حذف هذا الملف؟", "Delete this file?"],
  lk_opening: ["رصيد افتتاحي", "Opening balance"], lk_annual_credit: ["استحقاق سنوي", "Yearly entitlement"], lk_cap_forfeit: ["سقوط ما فوق ٦٠ يوماً", "Above 60-day cap"],
  lk_annual_leave: ["إجازة سنوية", "Annual leave"], lk_early_leave: ["مغادرة مبكرة", "Early leave"], lk_comp_credit: ["يوم إضافي", "Extra day"],
  lk_reversal: ["إلغاء", "Reversal"], lk_adjustment: ["تعديل", "Adjustment"],
  new_employee: ["موظف جديد", "New employee"], edit_employee: ["تعديل بيانات الموظف", "Edit employee"],
  // requests
  new_request: ["طلب جديد", "New request"], leave_type: ["نوع الطلب", "Request type"], start_date: ["من", "From"], end_date: ["إلى", "To"],
  date: ["التاريخ", "Date"], leave_time: ["وقت المغادرة", "Leaving at"], reason: ["السبب", "Reason"], reason_optional: ["السبب (اختياري)", "Reason (optional)"],
  worked_date: ["تاريخ يوم العمل", "Day worked"], submit_request: ["إرسال الطلب", "Submit request"], request_sent: ["تم إرسال الطلب", "Request submitted"],
  this_request: ["هذا الطلب", "This request"], available_after: ["المتاح بعد هذا الطلب", "Available after this request"],
  exceeds_balance: ["يتجاوز رصيدك المتاح", "Exceeds your available balance"], not_eligible: ["غير متاح قبل {d}", "Not available before {d}"],
  medical_note: ["تقرير طبي (اختياري)", "Medical note (optional)"], attach: ["إرفاق", "Attach"], attachments: ["المرفقات", "Attachments"],
  my_requests: ["طلباتي", "My requests"], all_requests: ["كل الطلبات", "All requests"], team_requests: ["طلبات القسم", "Team requests"],
  request_details: ["تفاصيل الطلب", "Request details"], history: ["السجل", "History"], approver: ["المعتمد", "Approver"],
  approve: ["موافقة", "Approve"], reject: ["رفض", "Reject"], cancel_request: ["إلغاء الطلب", "Cancel request"],
  reject_reason: ["سبب الرفض", "Reason for rejection"], cancel_reason: ["سبب الإلغاء (اختياري)", "Reason (optional)"],
  approve_q: ["الموافقة على هذا الطلب؟", "Approve this request?"], cancel_q: ["إلغاء هذا الطلب؟", "Cancel this request?"],
  comment_optional: ["ملاحظة (اختياري)", "Comment (optional)"], approved_ok: ["تمت الموافقة", "Approved"], rejected_ok: ["تم الرفض", "Rejected"], cancelled_ok: ["تم الإلغاء", "Cancelled"],
  no_approvals: ["لا توجد طلبات بانتظارك", "Nothing waiting for you"], current_balance: ["الرصيد الحالي", "Current balance"],
  employee: ["الموظف", "Employee"], amount: ["المدة", "Amount"], submitted_at: ["تاريخ التقديم", "Submitted"], status: ["الحالة", "Status"],
  route_dept: ["مدير القسم", "Department manager"], route_managers: ["اعتماد المديرين", "Managers' approver"], route_admin: ["مدير النظام", "Admin"],
  // notifications
  mark_all_read: ["تعليم الكل كمقروء", "Mark all as read"], no_notifications: ["لا توجد إشعارات", "No notifications"],
  // import
  import_title: ["استيراد الموظفين والأرصدة", "Import staff and balances"],
  step_upload: ["رفع الملف", "Upload"], step_map: ["مطابقة الأعمدة", "Map columns"], step_preview: ["المعاينة", "Preview"], step_done: ["تم", "Done"],
  choose_file: ["اختر ملف Excel أو CSV", "Choose an Excel or CSV file"], sheet: ["الورقة", "Sheet"], header_rows: ["صفوف العناوين", "Header rows"],
  header_row_from: ["العناوين تبدأ في الصف", "Headers start on row"], header_rows_count: ["عدد صفوف العناوين", "Number of header rows"],
  balance_as_of: ["الرصيد كما في تاريخ", "Balance as of"], data_rows_found: ["{n} صف بيانات (ينتهي عند أول صف بلا اسم)", "{n} data rows (ends at the first row without a name)"],
  download_template: ["تنزيل نموذج", "Download template"], next: ["التالي", "Next"], column: ["العمود", "Column"], maps_to: ["يُطابق", "Maps to"],
  ignore: ["تجاهل", "Ignore"], sample: ["مثال", "Sample"], run_preview: ["معاينة", "Preview"], create_logins: ["إنشاء حسابات دخول للموظفين", "Create logins for the staff"],
  only_errors: ["الأخطاء فقط", "Errors only"], import_rows: ["استيراد {n} موظف", "Import {n} staff"], import_done: ["تم استيراد {n} موظف", "{n} staff imported"],
  rows_ok: ["جاهز", "Ready"], rows_err: ["أخطاء (لن تُستورد)", "Errors (skipped)"], rows_warn: ["تنبيهات", "Warnings"],
  download_logins: ["تنزيل بيانات الدخول (CSV)", "Download logins (CSV)"], logins_note: ["احفظ هذا الملف الآن؛ لن تظهر كلمات المرور مرة أخرى.", "Save this file now; the passwords are not shown again."],
  need_name_column: ["طابق عمود الاسم أولاً", "Map a name column first"], import_again: ["استيراد ملف آخر", "Import another file"],
  ic_missing_name: ["الاسم مفقود", "Name missing"], ic_duplicate_in_file: ["رقم مكرر في الملف", "Duplicate ID in file"], ic_exists: ["الرقم موجود مسبقاً", "ID already exists"],
  ic_invalid_date: ["تاريخ غير صالح", "Invalid date"], ic_invalid_number: ["رقم غير صالح", "Not a number"], ic_negative_balance: ["رصيد سالب", "Negative balance"],
  ic_over_cap: ["أكثر من ٦٠ يوماً (يُطبق الحد عند الاستحقاق القادم)", "Over 60 days (cap applies at next credit)"], ic_generated_id: ["رقم مُنشأ", "Generated ID"],
  ic_missing_join_date: ["بدون تاريخ تعيين", "No join date"], ic_empty_balance: ["رصيد فارغ (٠)", "Empty balance (0)"], ic_unknown_department: ["قسم جديد سيُنشأ", "New department will be created"],
  ic_already_exists: ["موجود مسبقاً (نفس الاسم وتاريخ التعيين)", "Already exists (same name and join date)"],
  ic_unknown_manager: ["المدير غير موجود (سيُترك فارغاً)", "Manager not found (left empty)"],
  ic_unknown_gender: ["جنس غير معروف (سيُترك فارغاً)", "Unknown gender (left empty)"],
  ic_civil_id_expired: ["البطاقة منتهية", "Civil ID expired"], ic_invalid_email: ["بريد غير صالح (سيُتجاهل)", "Invalid email (dropped)"], ic_unknown_status: ["حالة غير معروفة", "Unknown status"],
  // settings / users / audit
  departments: ["الأقسام", "Departments"], add_department: ["إضافة قسم", "Add department"], dept_name_ar: ["اسم القسم بالعربية", "Name (Arabic)"],
  dept_name_en: ["اسم القسم بالإنجليزية", "Name (English)"], dept_approver: ["المعتمد للإجازات", "Leave approver"], no_approver: ["لم يُحدد (يذهب لمدير النظام)", "Not set (goes to Admin)"],
  managers_approver: ["معتمد إجازات المديرين", "Managers' leave approver"], managers_approver_title: ["الصفة", "Title"],
  title_ceo: ["الرئيس التنفيذي", "CEO"], title_chairman: ["رئيس مجلس الإدارة", "Chairman"], contract_types: ["أنواع العقود", "Contract types"],
  contract_types_hint: ["نوع في كل سطر", "One per line"], staff_n: ["{n} موظف", "{n} staff"], active: ["نشط", "Active"], inactive: ["غير نشط", "Inactive"],
  users_title: ["المستخدمون والصلاحيات", "Users and roles"], role: ["الصلاحية", "Role"], last_login: ["آخر دخول", "Last login"],
  reset_password: ["إعادة تعيين كلمة المرور", "Reset password"], deactivate: ["إيقاف", "Deactivate"], activate: ["تفعيل", "Activate"],
  add_user: ["إضافة مستخدم", "Add user"], link_employee: ["ربط بموظف", "Linked employee"], backup_download: ["تنزيل نسخة احتياطية", "Download backup"],
  audit_title: ["سجل التغييرات", "Audit log"], at: ["الوقت", "When"], actor: ["بواسطة", "By"], action: ["الإجراء", "Action"], details: ["التفاصيل", "Details"],
  load_more: ["تحميل المزيد", "Load more"],
  // server error codes
  err_invalid: ["قيمة غير صالحة", "Invalid value"], err_duplicate_emp_no: ["الرقم الوظيفي مستخدم", "This employee ID is already used"],
  err_duplicate_username: ["اسم المستخدم مستخدم", "This username is taken"], err_has_login: ["للموظف حساب دخول بالفعل", "This employee already has a login"],
  err_forbidden: ["ليست لديك صلاحية", "You do not have permission"], err_not_found: ["غير موجود", "Not found"],
  err_overlap: ["تتداخل التواريخ مع طلب آخر", "These dates overlap another request"], err_insufficient_balance: ["يتجاوز رصيدك المتاح", "This exceeds your available balance"],
  err_not_eligible_yet: ["الإجازة غير متاحة قبل إكمال ٦ أشهر من التعيين", "Leave is available after 6 months of service"],
  err_not_pending: ["تم البت في هذا الطلب مسبقاً", "This request has already been decided"], err_not_cancellable: ["لا يمكن إلغاء هذا الطلب", "This request cannot be cancelled"],
  err_unsupported_type: ["نوع الملف غير مدعوم (PDF أو صورة)", "Unsupported file type (PDF or image)"], err_too_large: ["الملف كبير جداً (الحد ١٠ ميجابايت)", "File too large (10 MB max)"],
  err_bad_origin: ["طلب مرفوض", "Request refused"],
  err_too_long: ["المدة أطول من المسموح قانوناً", "Longer than the law allows"], err_outside_window: ["خارج الفترة المسموح بها", "Outside the allowed period"],
  err_already_taken: ["تُمنح مرة واحدة طوال الخدمة وقد استُخدمت", "Allowed once during the service, already used"], err_year_limit: ["تجاوز الحد السنوي", "Over the yearly limit"],
  err_not_entitled: ["هذه الإجازة غير متاحة لهذا الموظف", "This leave is not available for this employee"], err_gender_required: ["يجب على الموارد البشرية تسجيل الجنس أولاً", "HR must record the gender first"],
  err_proof_required: ["أرفق المستند المؤيد قبل الموافقة", "Attach the supporting document before approval"], err_too_late: ["لا يجوز التأجيل أكثر من ٦ أشهر", "Postponement can't exceed 6 months"],
  err_consent_required: ["ارفع موافقة الموظف الكتابية أولاً", "Upload the employee's written consent first"],
  err_deputy_required: ["اختر نائباً يتولى الموافقات أثناء غيابك", "Name a deputy to handle your approvals while you're away"],
  err_consent_used: ["استُخدمت هذه الموافقة لصرف سابق؛ ارفع موافقة جديدة", "This consent was already used; upload a new one"],
  err_cover_required: ["هذا النائب يغطي إجازتك؛ ألغِ الإجازة أولاً", "This deputy covers your own leave; cancel the leave first"],
  death_date: ["تاريخ الوفاة", "Date of death"], child_birth_date: ["تاريخ ميلاد الطفل", "Child's date of birth"], bal_encashed: ["صُرف نقداً", "Paid in cash"],
  err_weak_password: ["كلمة المرور قصيرة (٨ أحرف على الأقل)", "Password too short (at least 8 characters)"], err_wrong_password: ["كلمة المرور الحالية غير صحيحة", "Current password is wrong"],
  err_same_password: ["اختر كلمة مرور مختلفة", "Choose a different password"], err_no_profile: ["حسابك غير مرتبط بملف موظف", "Your login is not linked to a staff profile"],
  // documents, civil ID scan, holiday calendar
  scan_camera: ["تصوير بالكاميرا", "Scan with camera"], upload_file: ["رفع ملف", "Upload file"],
  civil_id_copy: ["صورة البطاقة المدنية", "Civil ID copy"], civil_id_missing: ["لم تُرفع صورة البطاقة بعد — صوّر الوجهين أو ارفع ملف PDF.", "No ID copy yet — scan both sides or upload a PDF."],
  holiday_from: ["من تاريخ", "From"], holiday_to: ["إلى تاريخ", "To"], holiday_to_hint: ["اتركه فارغاً ليوم واحد", "Leave empty for one day"],
  holiday_name: ["اسم العطلة", "Holiday name"], holiday_name_ph: ["مثل: عيد الفطر", "e.g. Eid Al Fitr"], holiday_add: ["إضافة", "Add"],
  hol_status: ["الحالة", "Status"], holiday_past: ["مضت", "Passed"], in_days: ["بعد {n} يوم", "In {n} days"], today: ["اليوم", "Today"],
  weekday: ["يوم الأسبوع", "Day"], weekend: ["عطلة نهاية الأسبوع", "Weekend"], holidays_count: ["{n} يوم عطلة", "{n} holiday days"],
  holidays_none_year: ["لا توجد عطلات مسجلة لعام {y}", "No holidays added for {y}"], err_end_before_start: ["تاريخ النهاية قبل البداية", "End date is before the start"],
  holidays_save_hint: ["اضغط «حفظ» لاعتماد التغييرات", "Press Save to keep your changes"],
  // short labels for the phone bottom bar
  nav_calendar_short: ["التقويم", "Calendar"], nav_approvals_short: ["الموافقات", "Approvals"], nav_leave_short: ["إجازاتي", "My leave"], nav_me_short: ["ملفي", "Profile"],
  // dev login by staff name
  choose_your_name: ["اختر اسمك", "Choose your name"], staff_name: ["اسم الموظف", "Staff name"],
  sign_in_username: ["الدخول باسم المستخدم (المسؤول)", "Sign in with username (admin)"], sign_in_staff_list: ["الدخول من قائمة الموظفين", "Sign in from the staff list"],
  both_lang_hint: ["لعرضها باللغتين اكتب: English | عربي", "To show it in both languages write: English | عربي"],
  // reading ID cards and passports
  reading_card: ["جارٍ قراءة البيانات من الصورة…", "Reading the card…"], read_title: ["البيانات المقروءة من المستند", "Details read from the document"],
  read_intro: ["راجع القيم واختر ما تريد تحديثه في الملف. لن يتغير شيء دون تأكيدك.", "Check the values and tick what to update in the profile. Nothing changes until you confirm."],
  read_verified: ["مؤكد من البطاقة", "Confirmed by the card"], read_check: ["تحقّق منه", "Please check"], read_now: ["في الملف الآن", "Now in profile"],
  read_same: ["مطابق", "Same"], read_saved_on_copy: ["حُفظ مع نسخة المستند للتنبيه قبل الانتهاء", "Saved with the copy for expiry alerts"],
  read_nothing: ["حُفظت النسخة. لم تُقرأ بيانات واضحة — صوّر الوجه الخلفي (الأسطر <<<) في إضاءة جيدة.", "Copy saved. No clear details were read — photograph the back (the <<< lines) in good light."],
  read_skip: ["تخطي", "Skip"], read_apply: ["تحديث الملف", "Update profile"], doc_expired: ["منتهي", "Expired"],
  scan_tip: ["للقراءة التلقائية صوّر الوجه الخلفي للبطاقة (الأسطر <<<) بشكل مستقيم وفي إضاءة جيدة.", "For automatic reading, photograph the back of the card (the <<< lines) straight and in good light."],
  // permissions (early leave, late arrival, personal break)
  nav_permissions: ["الاستئذانات", "Permissions"], nav_permissions_short: ["استئذان", "Permissions"], my_permissions: ["استئذاناتي", "My permissions"],
  apply_permission: ["طلب استئذان", "Request permission"], permission_type: ["نوع الاستئذان", "Type of permission"],
  lt_late: ["تأخير في الحضور", "Late arrival"], lt_break: ["استئذان خلال الدوام", "Personal break"],
  perm_hint_early: ["المغادرة قبل نهاية الدوام.", "Leave before the end of the working day."],
  perm_hint_late: ["الحضور بعد بداية الدوام.", "Arrive after the start of the working day."],
  perm_hint_break: ["الخروج لفترة خلال ساعات الدوام ثم العودة.", "Step out for a while during working hours and come back."],
  arrival_time: ["وقت الحضور", "Arriving at"], break_from: ["من الساعة", "From"], break_to: ["إلى الساعة", "To"],
  arrive_at: ["الحضور {t}", "arrive {t}"], leave_at: ["المغادرة {t}", "leave {t}"],
  reason_required: ["اكتب سبب الاستئذان", "Please give a reason"],
  free_left_month: ["الساعات المجانية المتبقية هذا الشهر", "Free hours left this month"], from_annual: ["يُخصم من الإجازة السنوية", "Taken from annual leave"],
  perm_rule: ["الاستئذانات الثلاثة تشترك في {n} ساعات مجانية شهرياً، وما زاد يُخصم من الإجازة السنوية (8 ساعات = يوم).", "All three permissions share {n} free hours a month; the rest comes from annual leave (8 hours = 1 day)."],
  perm_holiday: ["هذا اليوم عطلة رسمية", "This day is an official holiday"],
  sec_permissions: ["الاستئذانات", "Permissions"], this_month: ["هذا الشهر", "This month"], this_year: ["هذه السنة", "This year"], last_month: ["الشهر الماضي", "Last month"],
  times_hours: ["{n} مرة · {h} ساعة", "{n} times · {h} h"], total: ["المجموع", "Total"],
  kind: ["النوع", "Type"], kind_leave: ["إجازات", "Leave"], kind_permission: ["استئذانات", "Permissions"],
  nav_reports: ["التقارير", "Reports"], report_permissions: ["تقرير الاستئذانات", "Permissions report"], period: ["الفترة", "Period"], custom_period: ["فترة محددة", "Custom dates"],
  only_used: ["إظهار من استخدم فقط", "Only people who used it"], approved_only: ["المعتمد فقط", "Approved only"], perm_none: ["لا توجد استئذانات في هذه الفترة", "No permissions in this period"],
  download_excel: ["تنزيل Excel", "Download Excel"], work_day_start: ["بداية الدوام", "Start of working day"],
  // own photo and contact
  photo_camera: ["التقاط صورة", "Take photo"], photo_upload: ["رفع صورة", "Upload photo"],
  email_by_hr: ["البريد الإلكتروني للعمل يضيفه قسم الموارد البشرية أو المسؤول.", "The work e-mail is added by HR or Admin."],
  // Staff Voice
  nav_voice: ["صوت الموظف", "Staff Voice"], nav_voice_short: ["رسائل", "Messages"], voice_new: ["رسالة جديدة", "New message"],
  voice_intro: ["اقتراحات واستفسارات وشكاوى وملاحظات إلى مديرك أو الموارد البشرية أو الرئيس التنفيذي. تُرسل باسمك ولا يراها غير المرسل إليه.", "Suggestions, questions, complaints and notes to your manager, HR or the CEO. Sent with your name and seen only by the person you send it to."],
  voice_sent: ["رسائلي", "My messages"], voice_inbox: ["الوارد", "Inbox"],
  voice_sent_empty: ["لم ترسل أي رسالة بعد", "You haven't sent any messages yet"], voice_inbox_empty: ["لا توجد رسائل", "No messages"],
  vc_suggestion: ["اقتراح / تطوير", "Suggestion / improvement"], vc_question: ["استفسار / توضيح", "Question / clarification"], vc_complaint: ["شكوى", "Complaint"], vc_note: ["ملاحظة", "Note"], vc_other: ["أخرى", "Other"],
  vs_new: ["جديدة", "New"], vs_in_review: ["قيد المراجعة", "In review"], vs_answered: ["تم الرد", "Answered"], vs_closed: ["مغلقة", "Closed"],
  voice_to: ["إلى", "To"], voice_from: ["من", "From"], to_manager: ["مديري المباشر", "My manager"], to_hr: ["الموارد البشرية", "HR"], to_ceo: ["الرئيس التنفيذي", "The CEO"],
  to_manager_hint: ["لأمور العمل اليومية في قسمك", "For day-to-day work in your department"], to_hr_hint: ["يراها فريق الموارد البشرية", "Seen by the HR team"], to_ceo_hint: ["تصل إلى الرئيس التنفيذي فقط", "Reaches the CEO only"],
  voice_private: ["لا يرى رسالتك إلا من ترسلها إليه.", "Only the person you send it to can read your message."],
  voice_complaint_hint: ["إذا كانت الشكوى تخص مديرك فأرسلها إلى الموارد البشرية أو الرئيس التنفيذي.", "If the complaint is about your manager, send it to HR or the CEO instead."],
  voice_subject: ["الموضوع", "Subject"], voice_body: ["الرسالة", "Message"], attachment_optional: ["مرفق (اختياري)", "Attachment (optional)"],
  voice_named: ["تُرسل باسم: {name}", "Sent in your name: {name}"], voice_send: ["إرسال", "Send"], voice_sent_ok: ["تم إرسال رسالتك", "Your message was sent"],
  voice_reply: ["الرد", "Reply"], send: ["إرسال", "Send"], voice_closed_note: ["هذه المحادثة مغلقة", "This conversation is closed"],
  voice_close: ["إغلاق الرسالة", "Close message"], voice_reopen: ["إعادة فتح", "Reopen"], replies_n: ["{n} رد", "{n} replies"],
  voice_no_recipients: ["لا يوجد مستلم متاح بعد", "Nobody can receive messages yet"],
  voice_missing_manager: ["المدير: لم يُحدَّد مدير مباشر في ملفك ولا معتمد لقسمك (الإعدادات ← الأقسام).", "Manager: no direct manager on your profile and no approver for your department (Settings → Departments)."],
  voice_missing_hr: ["الموارد البشرية: لا يوجد مستخدم بصلاحية «الموارد البشرية» (المستخدمون).", "HR: no user has the HR role yet (Users)."],
  voice_missing_ceo: ["الرئيس التنفيذي: لم يُحدَّد مستخدم بصلاحية «الرئيس التنفيذي» ولا معتمد إجازات المدراء (الإعدادات).", "CEO: no user has the CEO role and no managers' leave approver is set (Settings)."],
  voice_ask_admin: ["يمكن للمسؤول ضبط ذلك من الإعدادات والمستخدمين.", "Admin can set this up in Settings and Users."],
  report_voice: ["صوت الموظف", "Staff Voice"], report_voice_note: ["أعداد فقط — لا تظهر نصوص الرسائل في التقارير.", "Counts only — message text never appears in reports."], still_open: ["مفتوحة", "Still open"],
  // my leave / my permissions pages
  my_leave: ["إجازاتي", "My leave"], leave_taken: ["الإجازات المأخوذة", "Leave taken"], year: ["السنة", "Year"], month: ["الشهر", "Month"],
  times_n: ["{n} مرة", "{n} times"], pending_n: ["{n} قيد الموافقة", "{n} pending"],
  // years of service
  service_length: ["مدة الخدمة", "Years of service"], one_year: ["سنة واحدة", "1 year"], n_years: ["{n} سنوات", "{n} years"],
  one_month: ["شهر واحد", "1 month"], n_months: ["{n} أشهر", "{n} months"],
  two_years: ["سنتان", "2 years"], two_months: ["شهران", "2 months"], n_years_11: ["{n} سنة", "{n} years"], n_months_11: ["{n} شهراً", "{n} months"], and_sep: [" و", " and "],
  less_than_month: ["أقل من شهر", "Less than a month"], not_started: ["لم يبدأ بعد", "Not started yet"],
  theme_dark: ["الوضع الداكن", "Dark mode"], theme_light: ["الوضع الفاتح", "Light mode"],
  // disable / enable / delete a staff record
  st_disabled: ["معطّل", "Disabled"], staff_disable: ["تعطيل", "Disable"], staff_enable: ["تفعيل", "Enable"], staff_delete: ["حذف نهائي", "Delete permanently"],
  staff_disable_q: ["تعطيل {name}؟ لن يتمكن من الدخول ولن يظهر في قائمة الدخول ولا في قائمة الموظفين، ويبقى سجله محفوظاً. يمكن إعادة التفعيل لاحقاً.", "Disable {name}? They can't sign in, and they leave the login list and the staff list. Their records are kept; you can enable them again later."],
  staff_enable_q: ["إعادة تفعيل {name}؟", "Enable {name} again?"],
  staff_delete_q: ["حذف {name} نهائياً؟ يُحذف الملف والمستندات والحساب ولا يمكن التراجع. يُسمح بذلك فقط إذا لم يكن له أي طلبات أو رسائل — وإلا استخدم «تعطيل».", "Delete {name} for good? The profile, documents and login are removed and this can't be undone. Only allowed when they have no requests or messages — otherwise use Disable."],
  staff_deleted: ["تم الحذف", "Deleted"], err_has_history: ["لهذا الموظف سجل طلبات أو رسائل — استخدم «تعطيل» ليبقى السجل محفوظاً", "This person has requests or messages — use Disable so the records are kept"],
  disabled_note: ["هذا الموظف معطّل: لا يمكنه الدخول ولا يظهر في القوائم.", "This person is disabled: no sign-in, and hidden from the lists."],
  // company calendar
  cal_add: ["إضافة إلى التقويم", "Add to calendar"], cal_blocked: ["أيام ممنوعة للإجازة", "No leave allowed"], cal_event: ["مناسبة للشركة", "Company occasion"],
  cal_birthday: ["عيد ميلاد", "Birthday"], cal_leave: ["إجازة", "Leave"], cal_name: ["الاسم / الوصف", "Name / description"],
  cal_birthday_of: ["عيد ميلاد {name} 🎉", "{name}'s birthday 🎉"], cal_nothing_day: ["لا شيء في هذا اليوم", "Nothing on this day"],
  cal_blocked_hint: ["لا تُقبل الإجازة السنوية ولا الخاصة بدون أجر ولا الاستئذانات", "No annual leave, special unpaid leave or permissions"],
  cal_hint_blocked: ["تُرفض فيها طلبات الإجازة السنوية والخاصة بدون أجر والاستئذانات. الإجازات التي يكفلها القانون (المرضية، الوفاة، الأمومة، الأبوة، الحج…) لا يمكن منعها.", "Annual leave, special unpaid leave and permissions are refused on these days. Leave guaranteed by law (sick, bereavement, maternity, paternity, Hajj…) can't be blocked."],
  cal_hint_event: ["تظهر للجميع في التقويم ويصلهم إشعار. لا تؤثر على الإجازات.", "Shown to everyone on the calendar, with a notification. Doesn't affect leave."],
  cal_hint_holiday: ["عطلة رسمية: لا تُخصم من الإجازة السنوية إذا وقعت داخلها.", "Official holiday: not counted when it falls inside annual leave."],
  delete_q: ["حذف؟", "Delete?"],
  err_blocked_days: ["لا يمكن طلب إجازة في هذه الأيام", "Leave can't be booked on these days"],
  birthdays_soon: ["أعياد ميلاد قريبة 🎂", "Birthdays coming up 🎂"], birthday_in: ["{name} — {d} ({n})", "{name} — {d} ({n})"], in_n_days: ["بعد {n} أيام", "in {n} days"], tomorrow: ["غداً", "tomorrow"],
  // import: update existing staff
  import_mode: ["نوع الاستيراد", "What to do"], import_mode_add: ["إضافة موظفين جدد", "Add new staff"],
  import_mode_add_hint: ["ينشئ ملفاً لكل صف ويضيف الرصيد الافتتاحي.", "Creates a profile for each row, with its opening balance."],
  import_mode_update: ["تحديث بيانات موظفين حاليين", "Update existing staff"],
  import_mode_update_hint: ["يطابق بالرقم الوظيفي (أو الاسم)، ويغيّر فقط الخانات المعبأة. لا يغيّر الأرصدة.", "Matches by employee ID (or exact name) and changes only the filled cells. Balances are never changed."],
  update_rows: ["تحديث {n} موظف", "Update {n} staff"], update_done: ["تم تحديث {n} موظف", "{n} staff updated"],
  ic_no_match: ["لا يوجد موظف مطابق", "No matching staff"], ic_ambiguous_match: ["أكثر من موظف بنفس الاسم — استخدم الرقم الوظيفي", "More than one person has this name — use the employee ID"],
  both_boxes_hint: ["اكتب كل خانة بالعربية والإنجليزية ليظهر الملف بلغة واحدة حسب اختيار المستخدم.", "Fill each field in Arabic and English so the profile reads in one language, whichever the person chooses."],
  pages: ["الصفحات", "Pages"], showing_of: ["{a}–{b} من {n}", "{a}–{b} of {n}"], tiles_hint: ["اضغط على أي مربع لعرض قائمته هنا.", "Tap a box to list its records here."],
  voice_hide: ["إخفاء", "Hide"], voice_unhide: ["إظهار", "Show again"], voice_hidden: ["مخفية", "Hidden"],
  voice_hide_q: ["إخفاء هذه الرسالة؟ لن يراها المرسل ولا المستلم، وتبقى للمسؤول فقط.", "Hide this message? The sender and the recipient won't see it any more; only Admin will."],
  voice_unhide_q: ["إظهار الرسالة للمرسل والمستلم من جديد؟", "Show the message to the sender and recipient again?"],
  voice_delete_q: ["حذف الرسالة وردودها ومرفقاتها نهائياً؟ لا يمكن التراجع.", "Delete the message, its replies and attachments for good? This can't be undone."],
  voice_hidden_note: ["هذه الرسالة مخفية: يراها المسؤول فقط.", "This message is hidden: only Admin can see it."],
  reset_password_q: ["إعادة تعيين كلمة مرور {name}؟ تُنشأ كلمة مرور مؤقتة ويُطلب منه تغييرها عند الدخول، ويُسجَّل خروجه من كل الأجهزة.", "Reset {name}'s password? A temporary password is created, they must change it at sign-in, and they're signed out everywhere."],
};

let lang = "ar";
export const getLang = () => lang;
export function setLang(l) {
  lang = l === "en" ? "en" : "ar";
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  try { localStorage.setItem("hr_lang", lang); } catch {}
}
export function t(key, vars) {
  const e = D[key];
  let s = e ? e[lang === "ar" ? 0 : 1] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
export const has = (key) => key in D;
/** Pick the name in the current language, falling back to the other. */
// Fixed answers from the staff questionnaire, so a profile reads in one language.
const ANSWERS = {
  "less than 1 year": "أقل من سنة", "1–3 years": "1–3 سنوات", "4–6 years": "4–6 سنوات", "7–10 years": "7–10 سنوات", "more than 10 years": "أكثر من 10 سنوات",
  arabic: "العربية", english: "الإنجليزية", hindi: "الهندية", urdu: "الأردية", indian: "الهندية", malayalam: "المالايالامية", bengali: "البنغالية",
  tagalog: "الفلبينية", filipino: "الفلبينية", french: "الفرنسية", persian: "الفارسية", farsi: "الفارسية", swahili: "السواحلية", german: "الألمانية", turkish: "التركية",
  yes: "نعم", no: "لا", "not sure": "غير متأكد", "not applicable": "لا ينطبق",
};
const AR_TO_EN = Object.fromEntries(Object.entries(ANSWERS).map(([en, ar]) => [ar, en.replace(/^\w/, (c) => c.toUpperCase())]));
const isArabic = (x) => /[\u0600-\u06FF]/.test(x);
function oneItem(x, L) {
  const parts = x.split(/\s*\|\s*/).filter(Boolean);
  if (parts.length === 2) { // "English | عربي"
    const ar = parts.find(isArabic), en = parts.find((y) => !isArabic(y));
    return L === "ar" ? ar || parts[1] : en || parts[0];
  }
  if (L === "ar") return ANSWERS[x.toLowerCase()] || x;
  return AR_TO_EN[x] || x;
}
/** Show free text in a language (the current one by default): picks one side of "English | عربي" pairs and translates the fixed questionnaire answers. */
export function tx(value, L = lang) {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value);
  // a whole field written in both languages: "English text | النص العربي"
  const halves = s.split(/\s+\|\s+/);
  if (halves.length === 2 && isArabic(halves[0]) !== isArabic(halves[1])) {
    return halves.find((x) => isArabic(x) === (L === "ar"));
  }
  if (!s.includes("|") && !Object.keys(ANSWERS).some((k) => s.toLowerCase().includes(k)) && !Object.keys(AR_TO_EN).some((k) => s.includes(k))) return s;
  return s.split("\n").map((line) => {
    const items = line.split(/\s*[,،]\s*/);
    const out = items.map((y) => (y.trim() ? oneItem(y.trim(), L) : y));
    return out.join(L === "ar" ? "، " : ", ");
  }).join("\n");
}
/** For the edit form: the Arabic and the English version of a stored value (text written in one language only fills that one). */
export function splitLangs(value) {
  if (value === null || value === undefined || value === "") return { ar: "", en: "" };
  const ar = tx(value, "ar"), en = tx(value, "en");
  if (ar !== en) return { ar, en };
  return isArabic(String(value)) ? { ar: String(value), en: "" } : { ar: "", en: String(value) };
}
/** Store both languages as "English | عربي" (or just the one that was filled). */
export const joinLangs = (ar, en) => { ar = String(ar || "").trim(); en = String(en || "").trim(); return ar && en ? `${en} | ${ar}` : ar || en; };
export const nm = (o, base = "name") => (o ? (lang === "ar" ? o[`${base}_ar`] || o[`${base}_en`] : o[`${base}_en`] || o[`${base}_ar`]) || "" : "");
/** Both translations of a key, e.g. to recognise either language in an uploaded file. */
export const both = (key) => D[key] || [key];
