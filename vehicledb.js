'use strict';

function buildVehicleDb() {
  const db = {};

  function add(nums, brand, model, year) {
    const list = Array.isArray(nums) ? nums : [nums];
    for (const n of list) {
      if (typeof n === 'string' && n.includes('-')) {
        const [a, b] = n.split('-').map(Number);
        for (let i = a; i <= b; i++) db[String(i)] = { brand, model, year: year||null };
      } else {
        db[String(n)] = { brand, model, year: year||null };
      }
    }
  }

  // Jelcz
  add(['677','681','682'], 'Jelcz',        'M121M/4 CNG',           2007);
  add('749',               'Solaris',      'Urbino 12 CNG',         2007);

  // Mercedes-Benz Citaro O530 diesel — wszystkie 2012
  add('805-834',           'Mercedes-Benz', 'Citaro O530',          2012);
  add('868-870',           'Mercedes-Benz', 'Citaro O530',          2012);

  // Mercedes-Benz Citaro O530 CNG — wszystkie 2013
  add('835-864',           'Mercedes-Benz', 'Citaro O530 CNG',      2013);

  // Mercedes-Benz Conecto LF — 2013
  add(['865','866','867'], 'Mercedes-Benz', 'Conecto LF',           2013);

  // Autosan Sancity 10LF — wszystkie 2013
  add('901-920',           'Autosan',       'Sancity 10LF',         2013);

  // Autosan Sancity 12LF diesel
  add('921',               'Autosan',       'Sancity 12LF',         2016);
  add('922-931',           'Autosan',       'Sancity 12LF',         2018);

  // Autosan Sancity 12LF CNG
  add('900',               'Autosan',       'Sancity 12LF CNG',     2016);
  add('932-971',           'Autosan',       'Sancity 12LF CNG',     2020);
  add('972-991',           'Autosan',       'Sancity 12LF CNG',     2021);
  add('300-309',           'Autosan',       'Sancity 12LF CNG',     2023);

  // Solaris Urbino 18
  add('759-788',           'Solaris',       'Urbino 18 IV',         2018);
  add(['789','790'],       'Solaris',       'Urbino 18 IV CNG',     2023);

  // Solaris electric
  add('100-109',           'Solaris',       'Urbino 12 IV Electric',2018);
  add(['110','111'],       'Solaris',       'Urbino 18 IV Electric',2023);
  add('112-117',           'Solaris',       'Urbino 9 LE Electric', 2023);

  // Solaris używane
  add(['791','792'],       'Solaris',       'Urbino 12',            2011);

  return db;
}

module.exports = { buildVehicleDb };
