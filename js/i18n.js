// English is the source language; Arabic is a phrase map. Missing phrases fall back to English.
const AR = {
  'Dashboard': 'لوحة التحكم', 'Rentals': 'الإيجارات', 'Fleet': 'الأسطول', 'Customers': 'العملاء', 'Payments': 'المدفوعات',
  'Fines & Salik': 'المخالفات وسالك', 'Maintenance': 'الصيانة', 'Expenses': 'المصروفات', 'Reports': 'التقارير', 'Team': 'الفريق',
  'Settings': 'الإعدادات', 'Activity': 'سجل النشاط', 'Sign out': 'تسجيل الخروج', 'Operations': 'العمليات', 'Money': 'المالية', 'Admin': 'الإدارة',
  'Sign in': 'تسجيل الدخول', 'Create account': 'إنشاء حساب', 'Email': 'البريد الإلكتروني', 'Password': 'كلمة المرور', 'Full name': 'الاسم الكامل',
  'Try the demo': 'جرّب النسخة التجريبية', 'Demo mode': 'وضع العرض التجريبي', 'Exit demo': 'الخروج من العرض', 'View as': 'عرض بصفة',
  'Waiting for approval': 'بانتظار الموافقة', 'New': 'جديد', 'Save': 'حفظ', 'Cancel': 'إلغاء', 'Delete': 'حذف', 'Edit': 'تعديل', 'Close': 'إغلاق',
  'Search…': 'بحث…', 'Export CSV': 'تصدير CSV', 'Actions': 'إجراءات', 'Status': 'الحالة', 'Notes': 'ملاحظات', 'Date': 'التاريخ', 'Amount': 'المبلغ',
  'Total': 'الإجمالي', 'Balance': 'الرصيد', 'Paid': 'مدفوع', 'Deposit': 'التأمين', 'Car': 'السيارة', 'Customer': 'العميل', 'Plate': 'اللوحة',
  'Make': 'الشركة المصنعة', 'Model': 'الطراز', 'Year': 'السنة', 'Category': 'الفئة', 'Color': 'اللون', 'Daily rate': 'السعر اليومي',
  'Weekly rate': 'السعر الأسبوعي', 'Monthly rate': 'السعر الشهري', 'Odometer': 'عداد المسافة', 'Insurance expiry': 'انتهاء التأمين',
  'Registration expiry': 'انتهاء التسجيل', 'Plate code': 'رمز اللوحة', 'Plate number': 'رقم اللوحة', 'Emirate': 'الإمارة',
  'Phone': 'الهاتف', 'Nationality': 'الجنسية', 'ID / Passport no.': 'رقم الهوية / الجواز', 'ID expiry': 'انتهاء الهوية',
  'Licence no.': 'رقم الرخصة', 'Licence expiry': 'انتهاء الرخصة', 'Address': 'العنوان', 'Blacklisted': 'محظور', 'Type': 'النوع',
  'Individual': 'فرد', 'Company': 'شركة', 'New rental': 'إيجار جديد', 'Start': 'البداية', 'End': 'النهاية', 'Days': 'الأيام',
  'Extras': 'إضافات', 'Discount': 'خصم', 'VAT': 'ضريبة القيمة المضافة', 'Subtotal': 'المجموع الفرعي', 'Fuel out': 'الوقود عند التسليم',
  'Fuel in': 'الوقود عند الإرجاع', 'Odometer out': 'العداد عند التسليم', 'Odometer in': 'العداد عند الإرجاع',
  'Hand over car': 'تسليم السيارة', 'Return car': 'استلام السيارة', 'Cancel booking': 'إلغاء الحجز', 'Take payment': 'استلام دفعة',
  'Print contract': 'طباعة العقد', 'Method': 'طريقة الدفع', 'Kind': 'النوع', 'Reference': 'المرجع', 'Location': 'الموقع',
  'Admin fee': 'رسوم إدارية', 'Match to rentals': 'مطابقة مع الإيجارات', 'Vendor': 'المورّد', 'Cost': 'التكلفة', 'Description': 'الوصف',
  'Opened': 'تاريخ الفتح', 'Mark done': 'إنهاء', 'Role': 'الدور', 'Active': 'نشط', 'Activate': 'تفعيل', 'Deactivate': 'إيقاف',
  'Company name': 'اسم الشركة', 'TRN': 'الرقم الضريبي', 'Currency': 'العملة', 'VAT %': 'نسبة الضريبة %', 'Salik admin fee': 'رسوم سالك الإدارية',
  'Fine admin fee %': 'نسبة الرسوم على المخالفات %', 'Available': 'متاحة', 'Rented': 'مؤجرة', 'In maintenance': 'في الصيانة', 'Retired': 'خارج الخدمة',
  'booked': 'محجوز', 'active': 'جارٍ', 'returned': 'مُرجع', 'cancelled': 'ملغى', 'available': 'متاحة', 'rented': 'مؤجرة', 'maintenance': 'صيانة',
  'retired': 'خارج الخدمة', 'open': 'مفتوح', 'done': 'منجز', 'new': 'جديد', 'charged': 'محمّل على العميل', 'company': 'على الشركة',
  'unmatched': 'غير مطابق', 'paid': 'مدفوع', 'disputed': 'معترض عليه', 'payment': 'دفعة', 'refund': 'استرداد', 'deposit': 'تأمين',
  'deposit_return': 'إرجاع التأمين', 'cash': 'نقدًا', 'card': 'بطاقة', 'bank': 'تحويل بنكي', 'cheque': 'شيك', 'salik': 'سالك',
  'traffic': 'مخالفة مرورية', 'parking': 'مواقف', 'other': 'أخرى', 'service': 'خدمة دورية', 'repair': 'إصلاح', 'tyres': 'إطارات',
  'accident': 'حادث', 'inspection': 'فحص', 'admin': 'مدير النظام', 'manager': 'مدير', 'agent': 'موظف تأجير', 'accountant': 'محاسب',
  'economy': 'اقتصادية', 'sedan': 'سيدان', 'suv': 'دفع رباعي', 'sports': 'رياضية', 'luxury': 'فاخرة', 'van': 'فان',
  'fuel': 'وقود', 'salary': 'رواتب', 'rent': 'إيجار', 'utilities': 'خدمات', 'insurance': 'تأمين', 'registration': 'تسجيل',
  'marketing': 'تسويق', 'office': 'مكتب', 'Revenue': 'الإيرادات', 'Collected': 'المحصّل', 'Outstanding': 'المستحق',
  'Utilisation': 'نسبة التشغيل', 'Cars out now': 'سيارات مؤجرة الآن', 'Due back today': 'إرجاع اليوم', 'Overdue': 'متأخر',
  'Pick-ups today': 'تسليم اليوم', 'Needs attention': 'يحتاج انتباه', 'Next 14 days': 'الأيام الـ14 القادمة', 'Recent activity': 'آخر النشاطات',
  'This month': 'هذا الشهر', 'Profit': 'الربح', 'Net': 'الصافي', 'Nothing here yet': 'لا توجد بيانات بعد', 'All': 'الكل',
  'Saved': 'تم الحفظ', 'Deleted': 'تم الحذف', 'Are you sure?': 'هل أنت متأكد؟', 'Yes, delete': 'نعم، احذف', 'Confirm': 'تأكيد',
  'Revenue by car': 'الإيرادات حسب السيارة', 'Monthly summary': 'الملخص الشهري', 'Month': 'الشهر', 'Rentals count': 'عدد الإيجارات',
  'Theme': 'المظهر', 'Language': 'اللغة', 'Board': 'لوحة', 'List': 'قائمة', 'Expires': 'ينتهي', 'Occurred': 'تاريخ الوقوع',
  'Who': 'المستخدم', 'Open': 'مفتوحة', 'Rental': 'الإيجار', 'Expenses ': 'المصروفات', 'What': 'العملية', 'When': 'الوقت', 'Read only': 'قراءة فقط', 'Forgot password?': 'نسيت كلمة المرور؟',
  'Import statement': 'استيراد كشف', 'Statement type': 'نوع الكشف', 'Authority': 'الجهة', 'Import and match': 'استيراد ومطابقة',
  'Detect from each row': 'تحديد تلقائي لكل سطر', 'Salik trips and Salik fines': 'رحلات ومخالفات سالك', 'Traffic fines (Police / RTA)': 'مخالفات مرورية (الشرطة / الهيئة)',
  'Parking fines': 'مخالفات المواقف', 'File (.xlsx or .csv)': 'ملف (.xlsx أو .csv)', 'Download a blank template': 'تنزيل نموذج فارغ',
  'Or paste rows from Excel (with the header row)': 'أو الصق الأسطر من Excel (مع سطر العناوين)', 'Columns': 'الأعمدة', 'ready': 'جاهز',
  'will be skipped': 'سيتم تخطيها', 'Times are read as Dubai time.': 'الأوقات بتوقيت دبي.', 'Details': 'التفاصيل', 'Black points': 'النقاط السوداء',
  'black points': 'نقاط سوداء', 'more rows': 'أسطر أخرى', 'added': 'أُضيفت', 'charged to customers': 'على العملاء', 'already in the system': 'موجودة مسبقاً',
  'No plate number': 'لا يوجد رقم لوحة', 'Date not understood': 'تاريخ غير مفهوم', 'No amount': 'لا يوجد مبلغ', 'No rows found.': 'لم يتم العثور على أسطر.',
  'Pasted rows': 'أسطر ملصقة', 'Plate (code and number together)': 'اللوحة (الرمز والرقم معاً)', 'Time': 'الوقت',
  'Taken from the file when it has a column for it': 'تؤخذ من الملف إن وُجد عمود لها',
};
let lang = 'en';
try { lang = localStorage.getItem('anamira.lang') || 'en'; } catch { /* storage blocked */ }
export const getLang = () => lang;
export const t = (s) => (lang === 'ar' && AR[s]) || s;
export function setLang(l) {
  lang = l === 'ar' ? 'ar' : 'en';
  try { localStorage.setItem('anamira.lang', lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
setLang(lang);
