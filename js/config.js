// Public client configuration. The publishable key is designed to live in the browser:
// it only identifies the project, and every table is locked down with Row Level Security.
// NEVER put a service_role / secret key in this file or anywhere in this repository.
export const CONFIG = Object.freeze({
  supabaseUrl: 'https://qqqrvbtudirsevrsjgak.supabase.co',
  supabaseKey: 'sb_publishable_ky_tJCbiuJIhySNo1WlsMQ_nbGk430k',
  appName: 'Anamira Car Rental',
  version: '2.0.0',
});
