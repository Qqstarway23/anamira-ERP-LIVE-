# Anamira Car Rental · ERP v2

A simple, systematic ERP for a car rental business in the UAE. It runs as a static site on GitHub Pages, and the data lives in Supabase (Postgres, Auth and Realtime).

**Live:** https://qqstarway23.github.io/anamira-ERP-LIVE-/
Press **Try the demo** on the login page to look around with sample data. The demo runs entirely in your browser.

## What's inside

| Area | What it does |
|---|---|
| Dashboard | Cars out, pick-ups and returns due today, overdue rentals, this month's revenue and cash, a "needs attention" list, and a 14-day fleet timeline |
| Rentals | Book a car, hand it over, take it back, take payments, print a bilingual contract. Pricing, VAT and late days are calculated automatically |
| Fleet | Board or list view of every car, with insurance and registration expiry warnings |
| Customers | ID, licence and blacklist status |
| Maintenance | Jobs per car. Opening a job takes the car out of service, and closing it brings the car back |
| Payments | Payments, refunds, deposits and deposit returns, each linked to a rental |
| Fines & Salik | Enter fines by plate and time, then **Match to rentals** assigns each one to the customer who had the car, with an admin fee |
| Expenses | Company costs by category |
| Reports | 6-month summary and revenue per car, with CSV export |
| Team | Approve new users and set their roles |
| Activity | A log of every change, which nobody can edit |

English and Arabic (RTL), light and dark themes, and it works on phones.

## The rental flow

```
booked ──hand over──▶ active ──return──▶ returned
   └──cancel──▶ cancelled
```

The database enforces every step:
* A car can't be double-booked (an exclusion constraint on overlapping dates).
* A blacklisted customer can't rent, and a car in maintenance can't be handed over.
* Days, subtotal, VAT and total are computed by a database trigger, so the browser can't change them. A late return is billed per started day after a 1-hour grace period.
* Car status (`available` / `rented` / `maintenance`) and odometer update automatically from rentals and maintenance jobs.
* Returned and cancelled rentals are frozen.

## Roles

|  | Admin | Manager | Agent | Accountant |
|---|:-:|:-:|:-:|:-:|
| Rentals, customers, maintenance | ✓ | ✓ | ✓ | read |
| Fleet (add/edit cars) | ✓ | ✓ | read | read |
| Take payments | ✓ | ✓ | ✓ | ✓ |
| Edit/delete payments | ✓ | | | ✓ |
| Fines & Salik | ✓ | ✓ | read | ✓ |
| Expenses | ✓ | ✓ | | ✓ |
| Team, settings | ✓ | read | | |

New sign-ups get **no access** until an admin activates them on the Team page.

## Project layout

```
index.html                 app shell with a strict Content-Security-Policy
assets/app.css             design system (light/dark, RTL, print)
assets/vendor/             supabase-js, vendored so no third-party script CDN is needed
js/app.js                  boot, shell, router
js/schema.js               one definition per business object (fields + columns)
js/rules.js                pricing and permission rules (mirrors the database)
js/backend-live.js         Supabase backend
js/backend-demo.js         in-browser demo backend with sample data
js/views/*.js              pages
supabase/migrations/*.sql  the whole database: schema, rules, security
supabase/tests/*.sql       behaviour and security tests (run against local Postgres)
```

## Setup (one time)

1. The Supabase project `anamira-car-rental` is linked to this repository through the Supabase GitHub integration, so every push to `main` applies any new file in `supabase/migrations`. Without the integration, run those files in order in the SQL editor.
2. In Supabase **Authentication → URL Configuration**, set the Site URL to the live link above.
3. Create your account with **Create account** on the live site, confirm the email, then make yourself the first admin in the SQL editor:
   ```sql
   update public.profiles set role = 'admin', active = true where email = 'you@example.com';
   ```
   From then on you can approve everyone else from the **Team** page.

## Running tests

```bash
psql -d <empty local db> -f supabase/tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do psql -d <db> -v ON_ERROR_STOP=1 -f $f; done
psql -d <db> -f supabase/tests/01_behaviour.sql   # prints ALL TESTS PASSED
```

## v1

The previous single-file version is kept on the `legacy-v1` branch. Its database tables were moved into the `legacy` schema in Supabase, not deleted.
