# Anamira Car Rental · ERP v2.1

A simple, systematic ERP for a car rental business in the UAE. It runs as a static site on GitHub Pages, and the data lives in Supabase (Postgres, Auth and Realtime).

**Live:** https://qqstarway23.github.io/anamira-ERP-LIVE-/
Press **Try the demo** on the login page to look around with sample data. The demo runs entirely in your browser.

## What's inside

| Area | What it does |
|---|---|
| Dashboard | Cars out, pick-ups and returns due today, overdue rentals, this month's revenue and cash, the top alerts, and a 14-day fleet timeline |
| Alerts | One list of everything that needs attention: overdue cars, expiring insurance, registration, licences, passports and IDs, service due, staff cars overdue, garage jobs late, unmatched fines, bills due, customers over their credit limit, open damages |
| Rentals | Book, hand over, return, take payments, print a bilingual contract. Tariff cards are picked automatically (the customer's own card first), km allowance with extra-km charge, additional driver, pick-up and return branch, extend or cut short, replace the vehicle mid-agreement, replace the driver, cancel with a reason. Every change is kept in the agreement history |
| Check-out / check-in | A phone-friendly vehicle check card: scan the car's QR label, check-list, damage diagram (exterior and interior) with photos, odometer and fuel, customer and staff signatures, printable card. It moves the rental or staff movement in the same step |
| Fleet | Board or list, SIPP/ACRISS codes, branch, tariff group, service interval, filters for insurance/registration/service due and open damages, vehicle history (movement log, damages, check cards, revenue vs garage cost), QR labels, de-fleet |
| Staff & custody | Non-revenue movements (NRM) and custody cars handed to employees. Fines during these go to the employee |
| Customers | Walk-in (cash) and corporate (credit) accounts with credit limit, codes, passport, ID and licence, statement of account. **Read passport or ID** fills the form from the machine-readable lines |
| Garage & maintenance | Jobs per car with supplier, job type and expected date. Closing a job can mark the car's damages repaired |
| Payments, Invoices | Receipts against agreements; invoices for fines, damage, fuel and other charges. Charged fines and tolls are invoiced automatically when a car comes back and every night (switch in Settings) |
| Fines & Salik | Import Salik, Darb, mall parking, Police or RTA statements. Each row is linked to the agreement that had the car at that time, also after a vehicle replacement; tolls are reconciled per period |
| Supplier bills, Vouchers | Bills from garages, tyre shops, insurers…; payment and receipt vouchers for suppliers, employees and others, printed with the amount in words |
| Accounts | Balances and 0-30 / 31-60 / 61-90 / 90+ day age analysis for customers (receivable), suppliers (payable) and employees, with printable statements of account |
| Reports | 6-month summary and revenue per car |
| Operational reports | Day summary, daily business report, fleet utilisation, monthly daily-status grid, vehicle movement log, missing mileage, estimated revenue by car and by agreement, agreements incl. cancelled, receivables and payables aging, tolls and mall parking with reconciliation. All print and export to CSV |
| Setup | Branches, departments, master lists (makes, models, engines, colours, service and defect types, check-list items) with a SIPP guide, tariff groups and tariff cards, employees and suppliers |
| Team, Activity | Approve users, set role, branch and department, see the access matrix; a log of every change with the before → after values |

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
* Car status (`available` / `rented` / `nrm` / `custody` / `maintenance`) and odometer update automatically from rentals, staff movements and maintenance jobs.
* Extra km over the agreement's allowance is charged on return, counting the km on every car used in that agreement.
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
| Check-out / check-in, staff movements | ✓ | ✓ | ✓ | read |
| Invoices | ✓ | ✓ | read | ✓ |
| Supplier bills, vouchers | ✓ | ✓ | | ✓ |
| Suppliers | ✓ | ✓ | read | ✓ |
| Setup (branches, masters, tariffs, employees) | ✓ | ✓ | read | read |
| Team, settings | ✓ | read | | |

New sign-ups get **no access** until an admin activates them on the Team page.

## Project layout

```
index.html                 app shell with a strict Content-Security-Policy
assets/app.css             design system (light/dark, RTL, print)
assets/vendor/             supabase-js and qrcode-generator (MIT), vendored so no third-party script CDN is needed
js/app.js                  boot, shell, router
js/importer.js             reads fines/Salik statements (CSV, .xlsx, pasted rows) and detects the columns
js/schema.js               one definition per business object (fields + columns)
js/rules.js                pricing, tariff, SIPP and permission rules (mirrors the database)
js/ledger.js               statements of account and age analysis
js/backend-live.js         Supabase backend
js/backend-demo.js         in-browser demo backend with sample data
js/views/*.js              pages
supabase/migrations/*.sql  the whole database: schema, rules, security
supabase/tests/*.sql       behaviour and security tests (run against local Postgres)
```

## Setup (one time)

1. The database is Supabase project `yloxwfmgaiyednlepvvv`. Run the files in `supabase/migrations` in order in its SQL editor (or link the project with the Supabase GitHub integration so pushes to `main` apply them). Every migration is safe to run again.
   For the daily automatic fines invoices, turn on **pg_cron** in Database → Extensions before running the last migration (or run it again afterwards).
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
psql -d <db> -f supabase/tests/02_fines_import.sql   # prints IMPORT TESTS PASSED
psql -d <db> -f supabase/tests/03_crs_modules.sql    # prints CRS TESTS PASSED
```

## v1

The previous single-file version is kept on the `legacy-v1` branch. Its database tables were moved into the `legacy` schema in Supabase, not deleted.
