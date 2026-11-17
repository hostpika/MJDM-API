# Customer Support Runbook & Canned Responses

**Channel:** `support@mjdm.app`  
**Escalation Path:** Tier 1 (Support Lead) -> Tier 2 (Backend/Client Eng) -> On-Call Engineer  
**SLA Commitments:**
- Paid Customers (Lifetime & Annual Pro): First response < 4 hours; resolution < 24 hours.
- Free Trial & Community Users: First response < 24 hours.

---

## Canned Response Templates (Bilingual: English & Bengali)

### Template 1: License Key Not Received or Activation Assistance
**English:**
> Hello [Name],
> 
> Thank you for purchasing MJDM! Your license key is:
> `[LICENSE_KEY]`
> 
> To activate your license:
> 1. Open the MJDM Desktop application.
> 2. Click the **License** or **Register** menu in the top toolbar.
> 3. Paste your 25-character key and click **Activate**.
> 
> Note: Your Pro license can be used on up to three (3) personal computers. If you run into any issues, let us know!
> 
> Best regards,  
> MJDM Support Team

**বাংলা (Bengali):**
> প্রিয় [গ্রাহকের নাম],
> 
> MJDM প্রো সংস্করণ কেনার জন্য আপনাকে ধন্যবাদ! আপনার লাইসেন্স কী:
> `[LICENSE_KEY]`
> 
> লাইসেন্স সক্রিয় করার ধাপসমূহ:
> ১. MJDM ডেস্কটপ অ্যাপ ওপেন করুন।
> ২. ওপরের মেনুবার থেকে **License** বা **Register** অপশনে ক্লিক করুন।
> ৩. আপনার ২৫-অক্ষরের লাইসেন্স কী পেস্ট করে **Activate** বাটনে ক্লিক করুন।
> 
> উল্লেখ্য: আপনার প্রো লাইসেন্সটি সর্বোচ্চ ৩টি ব্যক্তিগত কম্পিউটারে ব্যবহার করা যাবে। কোনো সমস্যা হলে আমাদের জানাতে দ্বিধা করবেন না।
> 
> শুভেচ্ছান্তে,  
> MJDM সাপোর্ট টিম

---

### Template 2: Lost Passphrase / Emergency Recovery Key
**English:**
> Hello [Name],
> 
> Because MJDM Cloud Sync uses audited **Zero-Knowledge End-to-End Encryption (E2EE)**, your data is encrypted locally on your device before being uploaded. We do not possess your master key or passphrase, and we cannot decrypt your data on our servers.
> 
> To restore your account:
> - Use the **16-character Emergency Recovery Key** (`XXXX-XXXX-XXXX-XXXX`) provided to you when you first enabled Cloud Sync.
> - In the Desktop app, go to **Settings > Cloud Sync > Reset Passphrase with Recovery Key**.
> 
> If you have lost both your passphrase and your recovery key, your existing encrypted data cannot be decrypted. However, you can wipe the cloud data and start a fresh sync session without losing your locally downloaded files.
> 
> Best regards,  
> MJDM Security Team

**বাংলা (Bengali):**
> প্রিয় [গ্রাহকের নাম],
> 
> যেহেতু MJDM ক্লাউড সিঙ্ক কঠোর **জিরো-নলেজ এন্ড-টু-এন্ড এনক্রিপশন (E2EE)** প্রযুক্তি ব্যবহার করে, আপনার সকল ডেটা আপনার ডিভাইসেই এনক্রিপ্ট হয়ে ক্লাউডে জমা হয়। আমাদের সার্ভারে আপনার ডেটা ডিক্রিপ্ট করার কোনো প্রযুক্তিগত ক্ষমতা নেই।
> 
> আপনার অ্যাকাউন্ট পুনরুদ্ধার করতে:
> - ক্লাউড সিঙ্ক চালু করার সময় প্রাপ্ত **১৬-অক্ষরের ইমার্জেন্সি রিকভারি কী** (`XXXX-XXXX-XXXX-XXXX`) ব্যবহার করুন।
> - ডেস্কটপ অ্যাপের **Settings > Cloud Sync > Reset Passphrase with Recovery Key** অপশনে যান।
> 
> আপনি যদি পাসফ্রেজ ও রিকভারি কী উভয়ই হারিয়ে ফেলেন, তবে পূর্বের ক্লাউড ডেটা পুনরুদ্ধার করা সম্ভব নয়। তবে আপনি ক্লাউড ডেটা রিসেট করে সম্পূর্ণ নতুন সিঙ্ক সেশন চালু করতে পারেন, এতে আপনার লোকাল ডিভাইসের ফাইলের কোনো ক্ষতি হবে না।
> 
> শুভেচ্ছান্তে,  
> MJDM সিকিউরিটি টিম

---

### Template 3: Browser Extension "Bridge Disconnected" Fix
**English:**
> Hello [Name],
> 
> If the MJDM browser extension shows "Bridge Disconnected", it usually means the native companion binary manifest needs re-registration:
> 1. Open the MJDM Desktop application.
> 2. Go to **Settings > Browser Integration**.
> 3. Click **Reinstall Native Bridge Manifest**.
> 4. Completely close and restart your browser.
> 5. Click **Test Bridge** to verify the green status indicator.
> 
> Best regards,  
> MJDM Support Team

**বাংলা (Bengali):**
> প্রিয় [গ্রাহকের নাম],
> 
> ব্রাউজার এক্সটেনশনে "Bridge Disconnected" দেখালে নিচের ধাপগুলো অনুসরণ করুন:
> ১. MJDM ডেস্কটপ অ্যাপ ওপেন করুন।
> ২. **Settings > Browser Integration**-এ যান।
> ৩. **Reinstall Native Bridge Manifest** বাটনে ক্লিক করুন।
> ৪. আপনার ব্রাউজারটি বন্ধ করে পুনরায় ওপেন করুন।
> ৫. **Test Bridge** বাটনে ক্লিক করে সবুজ স্ট্যাটাস নিশ্চিত করুন।
> 
> শুভেচ্ছান্তে,  
> MJDM সাপোর্ট টিম

---

### Template 4: 14-Day Refund Processing
**English:**
> Hello [Name],
> 
> We are sorry to hear that MJDM did not meet your expectations! In accordance with our 14-Day Money-Back Guarantee, we have issued a 100% full refund for your order `[ORDER_ID]`.
> 
> The refund should reflect on your original payment method within 3–5 business days. Your license key has been deactivated.
> 
> If there was a specific feature missing that caused you to leave, we would love to hear your feedback so we can improve in future releases.
> 
> Best regards,  
> MJDM Team

**বাংলা (Bengali):**
> প্রিয় [গ্রাহকের নাম],
> 
> MJDM আপনার প্রত্যাশা পূরণ করতে না পারায় আমরা আন্তরিকভাবে দুঃখিত। আমাদের ১৪-দিনের মানি-ব্যাক গ্যারান্টি অনুযায়ী আপনার অর্ডার `[ORDER_ID]`-এর জন্য সম্পূর্ণ টাকা রিফান্ড প্রসেস করা হয়েছে।
> 
> ৩-৫ কার্যদিবসের মধ্যে রিফান্ডের অর্থ আপনার মূল পেমেন্ট অ্যাকাউন্টে যুক্ত হবে এবং আপনার লাইসেন্সটি বাতিল করা হয়েছে।
> 
> ভবিষ্যতে উন্নতির সুবিধার্থে আপনার কোনো সুনির্দিষ্ট ফিডব্যাক থাকলে আমাদের জানাতে পারেন।
> 
> শুভেচ্ছান্তে,  
> MJDM টিম
