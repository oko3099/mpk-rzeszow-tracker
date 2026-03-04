'use strict';

function buildVehicleDb() {
  const db = {};

  function add(nums, brand, model) {
    const list = Array.isArray(nums) ? nums : [nums];
    for (const n of list) {
      if (typeof n === 'string' && n.includes('-')) {
        const [a, b] = n.split('-').map(Number);
        for (let i = a; i <= b; i++) db[String(i)] = { brand, model };
      } else {
        db[String(n)] = { brand, model };
      }
    }
  }

  // Źródło: Wikipedia – tabela taboru MPK Rzeszów (stan 2025)
  add('749',       'Solaris',        'Urbino 12 CNG');
  add(['677','681','682'], 'Jelcz',  'M121M/4 CNG');
  add(['805-834','868-870'], 'Mercedes-Benz', 'O530');       // diesel, 33 szt.
  add('835-864',   'Mercedes-Benz',  'O530 CNG');            // CNG, 30 szt.
  add('901-920',   'Autosan',        'Sancity 10LF');        // 2012/2013, 20 szt.
  add('921',       'Autosan',        'Sancity 12LF');        // 2016
  add('922-931',   'Autosan',        'Sancity 12LF');        // 2018, 10 szt.
  add('900',       'Autosan',        'Sancity 12LF CNG');    // 2016 ex-demo
  add('932-991',   'Autosan',        'Sancity 12LF CNG');    // 2020/2021, 60 szt.
  add('300-309',   'Autosan',        'Sancity 12LF CNG');    // 2023, 10 szt.
  add('759-788',   'Solaris',        'Urbino 18 IV');        // 2018, 30 szt.
  add('100-109',   'Solaris',        'Urbino 12 Electric');  // 2018, 10 szt.
  add(['789','790'], 'Solaris',      'Urbino 18 IV CNG');    // 2023, 2 szt.
  add(['110','111'], 'Solaris',      'Urbino 18 IV Electric'); // 2023, 2 szt.
  add('112-117',   'Solaris',        'Urbino 9 LE Electric');// 2023, 6 szt.
  add(['865','866','867'], 'Mercedes-Benz', 'Conecto LF');   // 2013 (w MPK od V 2025)
  add(['791','792'], 'Solaris',      'Urbino 12');           // 2011 (od I 2025)

  return db;
}

module.exports = { buildVehicleDb };
