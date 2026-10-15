export interface Country {
  name: string;
  dialCode: string;
  code: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { name: 'India', dialCode: '+91', code: 'IN', flag: '🇮🇳' },
  { name: 'United States', dialCode: '+1', code: 'US', flag: '🇺🇸' },
  { name: 'United Kingdom', dialCode: '+44', code: 'GB', flag: '🇬🇧' },
  { name: 'United Arab Emirates', dialCode: '+971', code: 'AE', flag: '🇦🇪' },
  { name: 'Saudi Arabia', dialCode: '+966', code: 'SA', flag: '🇸🇦' },
  { name: 'Canada', dialCode: '+1', code: 'CA', flag: '🇨🇦' },
  { name: 'Australia', dialCode: '+61', code: 'AU', flag: '🇦🇺' },
  { name: 'Germany', dialCode: '+49', code: 'DE', flag: '🇩🇪' },
  { name: 'France', dialCode: '+33', code: 'FR', flag: '🇫🇷' },
  { name: 'Russia', dialCode: '+7', code: 'RU', flag: '🇷🇺' },
  { name: 'Indonesia', dialCode: '+62', code: 'ID', flag: '🇮🇩' },
  { name: 'Pakistan', dialCode: '+92', code: 'PK', flag: '🇵🇰' },
  { name: 'Bangladesh', dialCode: '+880', code: 'BD', flag: '🇧🇩' },
  { name: 'Brazil', dialCode: '+55', code: 'BR', flag: '🇧🇷' },
  { name: 'Nigeria', dialCode: '+234', code: 'NG', flag: '🇳🇬' },
  { name: 'Egypt', dialCode: '+20', code: 'EG', flag: '🇪🇬' },
  { name: 'Turkey', dialCode: '+90', code: 'TR', flag: '🇹🇷' },
  { name: 'Iran', dialCode: '+98', code: 'IR', flag: '🇮🇷' },
  { name: 'Vietnam', dialCode: '+84', code: 'VN', flag: '🇻🇳' },
  { name: 'Philippines', dialCode: '+63', code: 'PH', flag: '🇵🇭' },
  { name: 'Malaysia', dialCode: '+60', code: 'MY', flag: '🇲🇾' },
  { name: 'Singapore', dialCode: '+65', code: 'SG', flag: '🇸🇬' },
  { name: 'Thailand', dialCode: '+66', code: 'TH', flag: '🇹🇭' },
  { name: 'South Africa', dialCode: '+27', code: 'ZA', flag: '🇿🇦' },
  { name: 'Italy', dialCode: '+39', code: 'IT', flag: '🇮🇹' },
  { name: 'Spain', dialCode: '+34', code: 'ES', flag: '🇪🇸' },
  { name: 'Mexico', dialCode: '+52', code: 'MX', flag: '🇲🇽' },
  { name: 'Japan', dialCode: '+81', code: 'JP', flag: '🇯🇵' },
  { name: 'South Korea', dialCode: '+82', code: 'KR', flag: '🇰🇷' },
  { name: 'China', dialCode: '+86', code: 'CN', flag: '🇨🇳' },
  { name: 'Ukraine', dialCode: '+380', code: 'UA', flag: '🇺🇦' },
  { name: 'Poland', dialCode: '+48', code: 'PL', flag: '🇵🇱' },
  { name: 'Netherlands', dialCode: '+31', code: 'NL', flag: '🇳🇱' },
  { name: 'Sweden', dialCode: '+46', code: 'SE', flag: '🇸🇪' },
  { name: 'Switzerland', dialCode: '+41', code: 'CH', flag: '🇨🇭' },
  { name: 'Austria', dialCode: '+43', code: 'AT', flag: '🇦🇹' },
  { name: 'Belgium', dialCode: '+32', code: 'BE', flag: '🇧🇪' },
  { name: 'New Zealand', dialCode: '+64', code: 'NZ', flag: '🇳🇿' },
  { name: 'Ireland', dialCode: '+353', code: 'IE', flag: '🇮🇪' },
  { name: 'Israel', dialCode: '+972', code: 'IL', flag: '🇮🇱' },
  { name: 'Qatar', dialCode: '+974', code: 'QA', flag: '🇶🇦' },
  { name: 'Kuwait', dialCode: '+965', code: 'KW', flag: '🇰🇼' },
  { name: 'Oman', dialCode: '+968', code: 'OM', flag: '🇴🇲' },
  { name: 'Bahrain', dialCode: '+973', code: 'BH', flag: '🇧🇭' },
  { name: 'Nepal', dialCode: '+977', code: 'NP', flag: '🇳🇵' },
  { name: 'Sri Lanka', dialCode: '+94', code: 'LK', flag: '🇱🇰' },
  { name: 'Kazakhstan', dialCode: '+7', code: 'KZ', flag: '🇰🇿' },
  { name: 'Uzbekistan', dialCode: '+998', code: 'UZ', flag: '🇺🇿' },
  { name: 'Kenya', dialCode: '+254', code: 'KE', flag: '🇰🇪' },
  { name: 'Ghana', dialCode: '+233', code: 'GH', flag: '🇬🇭' },
  { name: 'Colombia', dialCode: '+57', code: 'CO', flag: '🇨🇴' },
  { name: 'Argentina', dialCode: '+54', code: 'AR', flag: '🇦🇷' },
  { name: 'Chile', dialCode: '+56', code: 'CL', flag: '🇨🇱' },
  { name: 'Peru', dialCode: '+51', code: 'PE', flag: '🇵🇪' },
];

export function findCountryByDialCode(dialCode: string): Country | undefined {
  return COUNTRIES.find(c => c.dialCode === dialCode);
}
