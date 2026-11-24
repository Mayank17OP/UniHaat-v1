// UniHaat seed data — realistic Delhi campus listings
// The colleges UniHaat serves, and the mail domain each one issues student
// addresses on.
//
// The `domain` is the offline copy of `colleges.email_domain` in the
// database — the same list the server enforces when it opens an account.
// Keep the two in step: `tests/college-email.spec.js` fails if they drift.
//
// `lat`/`lng` are the campus gate coordinates — the offline copy of
// `colleges.lat`/`colleges.lng`. They anchor location-based discovery:
// a listing's own coordinates sit a few hundred metres from its campus
// gate, and the distance a buyer sees is the haversine between the two.
export const COLLEGES = [
  { short: "DTU", label: "Delhi Technological University", domain: "dtu.ac.in", lat: 28.75, lng: 77.1177 },
  { short: "DU", label: "University of Delhi", domain: "du.ac.in", lat: 28.686, lng: 77.211 },
  { short: "Hansraj", label: "Hansraj College, DU", domain: "hansrajcollege.ac.in", lat: 28.677, lng: 77.206 },
  { short: "IIT Delhi", label: "IIT Delhi", domain: "iitd.ac.in", lat: 28.545, lng: 77.192 },
  { short: "Jamia", label: "Jamia Millia Islamia", domain: "jmi.ac.in", lat: 28.516, lng: 77.279 },
  { short: "Amity", label: "Amity University", domain: "amity.edu", lat: 28.546, lng: 77.232 },
  { short: "IPU", label: "Indraprastha University", domain: "ipu.ac.in", lat: 28.585, lng: 77.05 },
  { short: "NSUT", label: "Netaji Subhas University of Technology", domain: "nsut.ac.in", lat: 28.61, lng: 77.037 },
  { short: "DTC", label: "Delhi Technical Campus", domain: "delhitechnicalcampus.ac.in", lat: 28.4744, lng: 77.492 },
];

export const CATEGORIES = [
  { id: "furniture", label: "Furniture", icon: "M4 11V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M2 13h20v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4Z" },
  { id: "electronics", label: "Electronics", icon: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z" },
  { id: "phones", label: "Phones", icon: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" },
  { id: "books", label: "Books & Academic", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" },
  { id: "appliances", label: "Appliances", icon: "M5 3h14v18H5zM9 7h6" },
  { id: "sports", label: "Sports & Cycle", icon: "M12 3a9 9 0 1 0 9 9" },
  { id: "instruments", label: "Instruments", icon: "M9 18V5l12-2v13" },
  { id: "hostel", label: "Hostel Essentials", icon: "M3 21h18M5 21V7l7-4 7 4v14" },
];

export const PRODUCTS = [
  { id: "p1", title: "Study Table + Chair Combo", price: 2499, original: 5200, type: "sell", category: "furniture", condition: "Like new", ageMonths: 8, distance: 0.4, lat: 28.7505, lng: 77.118, college: "DTU", scope: "same", seller: "Aarav S.", rating: 4.9, deals: 12, img: "./assets/table-chair.svg", desc: "Solid wood study table with drawer + cushioned chair. Bought in Jan, barely used — shifting to PG. Pickup from DTU hostel gate.", accessories: "Table, chair, keys", repairs: "None", battery: null, clearance: false, created: 2 },
  { id: "p2", title: "iPhone 12 · 128GB · Blue", price: 14999, original: 64900, type: "sell", category: "phones", condition: "Good", ageMonths: 30, distance: 1.2, lat: 28.5455, lng: 77.1925, college: "IIT Delhi", scope: "nearby", seller: "Kabir M.", rating: 4.8, deals: 8, img: "./assets/iphone.svg", desc: "Battery health 84%. Minor scratches on frame, screen perfect. Box + cable included. Face ID working.", accessories: "Box, cable, cover", repairs: "Battery replaced once (2024)", battery: "84%", clearance: false, created: 1 },
  { id: "p3", title: "Casio fx-991ES Plus Calculator", price: 650, original: 1100, type: "sell", category: "electronics", condition: "Like new", ageMonths: 5, distance: 0.3, lat: 28.7498, lng: 77.1172, college: "DTU", scope: "same", seller: "Sana K.", rating: 5.0, deals: 6, img: "./assets/calculator.svg", desc: "Used for one semester only. All functions tested. Perfect for exams.", accessories: "Calculator, cover", repairs: "None", battery: null, clearance: false, created: 3 },
  { id: "p4", title: "Hero Sprint Cycle · 21 Gear", price: 3200, original: 9500, type: "sell", category: "sports", condition: "Good", ageMonths: 18, distance: 0.8, lat: 28.6865, lng: 77.2115, college: "DU", scope: "uni", seller: "Rohan D.", rating: 4.7, deals: 4, img: "./assets/cycle.svg", desc: "New tyres, brakes serviced last month. Great for campus commute.", accessories: "Lock, pump", repairs: "Brake pads replaced", battery: null, clearance: false, created: 5 },
  { id: "p5", title: "Single Mattress · 4 inch Foam", price: 1800, original: 4500, type: "sell", category: "hostel", condition: "Good", ageMonths: 10, distance: 0.6, lat: 28.6775, lng: 77.2065, college: "Hansraj, DU", scope: "same", seller: "Priya N.", rating: 4.9, deals: 9, img: "./assets/mattress.svg", desc: "Hostel clearance — moving out. Clean, no stains, with cover. Combined pickup available.", accessories: "Mattress + cover", repairs: "None", battery: null, clearance: true, created: 4 },
  { id: "p6", title: "Engineering Books Set · Sem 3–4", price: 900, original: 3400, type: "sell", category: "books", condition: "Good", ageMonths: 12, distance: 0.5, lat: 28.7502, lng: 77.1175, college: "DTU", scope: "same", seller: "Aarav S.", rating: 4.9, deals: 12, img: "./assets/books.svg", desc: "Thermodynamics, Strength of Materials, Maths — with highlighted notes. Bundle only.", accessories: "6 books + notes", repairs: "—", battery: null, clearance: false, created: 6 },
  { id: "p7", title: "Electric Kettle · 1.8L Steel", price: 499, original: 1299, type: "sell", category: "appliances", condition: "Good", ageMonths: 9, distance: 0.4, lat: 28.5165, lng: 77.2795, college: "Jamia", scope: "nearby", seller: "Imran F.", rating: 4.6, deals: 3, img: "./assets/kettle.svg", desc: "Fast boil, auto cut-off. Hostel-approved model.", accessories: "Kettle + base", repairs: "None", battery: null, clearance: true, created: 7 },
  { id: "p8", title: "Laptop Stand + Wireless Keyboard", price: 1200, original: 2800, type: "sell", category: "electronics", condition: "Like new", ageMonths: 4, distance: 1.5, lat: 28.5448, lng: 77.1918, college: "IIT Delhi", scope: "nearby", seller: "Kabir M.", rating: 4.8, deals: 8, img: "./assets/laptop-keyboard.svg", desc: "Aluminium stand (adjustable) + membrane keyboard. Selling as a set.", accessories: "Stand, keyboard, USB receiver", repairs: "None", battery: null, clearance: false, created: 2 },
  { id: "p9", title: "Mini Fridge 90L · Single Door", price: 6500, original: 14500, type: "rent", category: "appliances", condition: "Good", ageMonths: 16, distance: 0.9, lat: 28.5465, lng: 77.2325, college: "Amity", scope: "nearby", seller: "Dev P.", rating: 4.7, deals: 15, img: "./assets/fridge.svg", desc: "Rent ₹900/month, 1-month minimum. Deposit ₹2,000 refundable. Perfect for hostel.", accessories: "Fridge, keys", repairs: "Compressor serviced 2025", battery: null, clearance: false, created: 8, rentPer: "₹900/mo" },
  { id: "p10", title: "Acoustic Guitar · Yamaha F310", price: 2800, original: 8500, type: "exchange", category: "instruments", condition: "Good", ageMonths: 20, distance: 1.1, lat: 28.6858, lng: 77.2108, college: "DU", scope: "uni", seller: "Sana K.", rating: 5.0, deals: 6, img: "./assets/guitar.svg", desc: "Exchange for a ukulele or sell. Fresh strings, no cracks. Bag included.", accessories: "Bag, capo, picks", repairs: "None", battery: null, clearance: false, created: 9, exchangeFor: "Ukulele / keyboard" },
  { id: "p11", title: "Lab Coat + Apron Set (Free)", price: 0, original: 1200, type: "free", category: "hostel", condition: "Good", ageMonths: 6, distance: 0.7, lat: 28.5158, lng: 77.2788, college: "Jamia", scope: "nearby", seller: "Imran F.", rating: 4.6, deals: 3, img: "./assets/lab-coat.svg", desc: "Free for a junior who needs it. Size M. First come, first served.", accessories: "Coat + apron", repairs: "—", battery: null, clearance: true, created: 10 },
  { id: "p12", title: "LED Table Lamp · Rechargeable", price: 350, original: 899, type: "sell", category: "hostel", condition: "Like new", ageMonths: 3, distance: 0.3, lat: 28.7508, lng: 77.117, college: "DTU", scope: "same", seller: "Aarav S.", rating: 4.9, deals: 12, img: "./assets/lamp.svg", desc: "3 brightness levels, USB rechargeable. Ideal for hostel desk.", accessories: "Lamp + cable", repairs: "None", battery: null, clearance: true, created: 11 },
  { id: "p13", title: "HP Laser Printer · WiFi", price: 2200, original: 6800, type: "sell", category: "electronics", condition: "Fair", ageMonths: 28, distance: 2.1, lat: 28.5855, lng: 77.0505, college: "IP University", scope: "nearby", seller: "Dev P.", rating: 4.7, deals: 15, img: "./assets/printer.svg", desc: "Works fine, toner at 40%. Good for assignments & notes printing.", accessories: "Printer, cable", repairs: "Roller cleaned", battery: null, clearance: false, created: 12 },
  { id: "p14", title: "Hostel Clearance Bundle · Priya's Room", price: 4999, original: 14200, type: "sell", category: "hostel", condition: "Good", ageMonths: 10, distance: 0.6, lat: 28.6772, lng: 77.2062, college: "Hansraj, DU", scope: "same", seller: "Priya N.", rating: 4.9, deals: 9, img: "./assets/bundle.svg", desc: "Mattress + table + chair + lamp + kettle + storage box. One pickup, bundle discount applied.", accessories: "6 items (see list)", repairs: "None", battery: null, clearance: true, created: 13, bundle: true },
  { id: "p15", title: "Engineering Drawing Kit + Drafter", price: 480, original: 1200, type: "sell", category: "books", condition: "Like new", ageMonths: 4, distance: 0.4, lat: 28.4748, lng: 77.4925, college: "DTC", scope: "nearby", seller: "Karan V.", rating: 4.8, deals: 5, img: "./assets/books.svg", desc: "Mini drafter, compass box, and sheet holder. Pickup near Delhi Technical Campus (DTC) main gate.", accessories: "Drafter, box, holder", repairs: "None", battery: null, clearance: false, created: 14 },
];

export const DEMANDS = [
  { id: "d1", title: "Scientific calculator fx-991", category: "electronics", budget: 800, college: "DTU", neededBy: "2026-12-05", user: "Aarav S.", notes: "Urgent for end-sem exams" },
  { id: "d2", title: "Cycle for campus commute", category: "sports", budget: 3500, college: "DU", neededBy: "2026-12-10", user: "Rohan D.", notes: "Hostel pickup preferred" },
  { id: "d3", title: "Single mattress", category: "hostel", budget: 2000, college: "Hansraj, DU", neededBy: "2026-12-01", user: "Meera J.", notes: "Moving into hostel in Dec" },
  { id: "d4", title: "iPhone under 15k", category: "phones", budget: 15000, college: "IIT Delhi", neededBy: "2026-12-15", user: "Kabir M.", notes: "128GB minimum" },
];

export const CLEARANCE = ["p14", "p5", "p11"];

// UniReserve — the rentable stock of the campus.
//
// This is the offline copy of the `reserve_resource_types` and
// `reserve_resource_units` tables. The counts the interface shows are the
// server's counts whenever the server is there; these rows are what the
// feature falls back to when it is not, so the numbers it shows are still
// real numbers rather than placeholders.
export const RESERVE_TYPES = [
  { slug: "cycles", label: "Cycles", unit_label: "cycle", category: "sports", monthly_rate: 400, sort: 1, description: "Campus cycles for the semester — the ones everybody wants in October." },
  { slug: "calculators", label: "Calculators", unit_label: "calculator", category: "electronics", monthly_rate: 250, sort: 2, description: "Scientific calculators for the exam season. Borrow, do the paper, bring it back." },
  { slug: "furniture", label: "Furniture", unit_label: "set", category: "furniture", monthly_rate: 900, sort: 3, description: "Study tables, chairs and shelves — the things a hostel room is missing." },
  { slug: "hostel-gear", label: "Hostel gear", unit_label: "kit", category: "hostel", monthly_rate: 300, sort: 4, description: "Mattresses, lamps, kettles and the rest of a room." },
  { slug: "instruments", label: "Instruments", unit_label: "instrument", category: "instruments", monthly_rate: 700, sort: 5, description: "Guitars, keyboards and the practice room gear." },
];

export const RESERVE_UNITS = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `u-cycle-${i + 1}`, type: "cycles", label: `Campus cycle ${i + 1}`, monthly_rate: 400 })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `u-calc-${i + 1}`, type: "calculators", label: `Scientific calculator ${i + 1}`, monthly_rate: 250 })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `u-furn-${i + 1}`, type: "furniture", label: `Study table and chair ${i + 1}`, monthly_rate: 900 })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `u-hostel-${i + 1}`, type: "hostel-gear", label: `Hostel kit ${i + 1}`, monthly_rate: 300 })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `u-inst-${i + 1}`, type: "instruments", label: `Guitar ${i + 1}`, monthly_rate: 700 })),
];
