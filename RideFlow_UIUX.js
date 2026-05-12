// server.js
// Run with: node server.js
// Open: http://localhost:3000

const express   = require('express');
const session   = require('express-session');
const FileStore = require('session-file-store')(session);
const db        = require('./db');
const fs        = require('fs');
const path      = require('path');

// Auto-create sessions directory if it doesn't exist
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}


// ==========================================
// FARE CALCULATION HELPER
// Uses Haversine distance + vehicle type rates.
// No fare_rules table needed — graceful fallback built-in.
// ==========================================
const BASE_RATES = {
  economy: { base: 50,  perKm: 25, perMin: 3   },
  premium: { base: 100, perKm: 45, perMin: 5   },
  bike:    { base: 30,  perKm: 12, perMin: 1.5 }
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcFare(pickupLoc, dropoffLoc, vehicleType, surge) {
  surge = surge || 1.0;
  const rates = BASE_RATES[vehicleType] || BASE_RATES.economy;
  const distKm = Math.max(1, haversineKm(
    parseFloat(pickupLoc.latitude),  parseFloat(pickupLoc.longitude),
    parseFloat(dropoffLoc.latitude), parseFloat(dropoffLoc.longitude)
  ));
  const durationMin = Math.round(distKm / 30 * 60);
  const fare = Math.round((rates.base + rates.perKm * distKm + rates.perMin * durationMin) * surge);
  return { fare, distanceKm: Math.round(distKm * 10) / 10, durationMin };
}

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new FileStore({
    path:         './sessions',  // sessions saved to disk - survive restarts
    ttl:          86400,         // 24 hours in seconds
    reapInterval: 3600           // clean expired files every hour
  }),
  secret:            'rideflow_secret',
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  cookie: {
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000  // 24 hours in ms
  }
}));
app.set('view engine', 'ejs');
app.use(express.static('public'));


// ==========================================
// MIDDLEWARE: Protect dashboard routes
// Also re-checks account_status on every request
// so bans/suspensions take effect immediately
// even for already logged-in users
// ==========================================
app.use((req, res, next) => {
  const protectedPaths = ['/rider', '/driver', '/admin'];
  const isProtected = protectedPaths.some(p => req.path === p || req.path.startsWith(p + '/'));

  if (!isProtected) return next();

  if (!req.session || !req.session.user) {
    return res.redirect('/');
  }

  // Re-check status from DB on every dashboard request
  db.query(`SELECT account_status FROM users WHERE user_id = ?`, [req.session.user.user_id], (err, rows) => {
    if (err || rows.length === 0) {
      req.session.destroy();
      return res.redirect('/');
    }

    const status = rows[0].account_status;

    if (status === 'banned') {
      req.session.destroy();
      return res.send(`
        <div style="font-family:Arial;text-align:center;margin-top:80px">
          <h2 style="color:red">🚫 Account Banned</h2>
          <p>Your account has been permanently banned.</p>
          <p>Please contact support if you believe this is a mistake.</p>
        </div>
      `);
    }

    if (status === 'suspended') {
      req.session.destroy();
      return res.send(`
        <div style="font-family:Arial;text-align:center;margin-top:80px">
          <h2 style="color:orange">⚠️ Account Suspended</h2>
          <p>Your account has been temporarily suspended.</p>
          <p>Please contact support for more information.</p>
          <a href="/" style="color:#2196F3">← Back to Login</a>
        </div>
      `);
    }

    next();
  });
});


// ==========================================
// PAGE: Login
// ==========================================
app.get('/', (req, res) => {
  res.send(`
    <html><head><title>RideFlow</title>
    <style>
      body { font-family:Arial; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; background:#f0f0f0; }
      .box { background:white; padding:40px; border-radius:10px; width:320px; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
      h2 { text-align:center; color:#333; }
      input { width:100%; padding:10px; margin:8px 0; border:1px solid #ddd; border-radius:5px; box-sizing:border-box; }
      button { width:100%; padding:12px; background:#4CAF50; color:white; border:none; border-radius:5px; font-size:16px; cursor:pointer; }
      button:hover { background:#45a049; }
      p { text-align:center; margin-top:15px; }
    </style></head>
    <body>
      <div class="box">
        <h2>🚗 RideFlow Login</h2>
        <form method="POST" action="/login">
          <input type="email"    name="email"    placeholder="Email"    required />
          <input type="password" name="password" placeholder="Password" required />
          <button type="submit">Login</button>
        </form>
        <p><a href="/register">Don't have an account? Register</a></p>
      </div>
    </body></html>
  `);
});


// ==========================================
// PAGE: Register
// Driver fields show/hide based on role selection
// ==========================================
app.get('/register', (req, res) => {
  res.send(`
    <html><head><title>Register - RideFlow</title>
    <style>
      body { font-family:Arial; display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; background:#f0f0f0; padding:20px 0; }
      .box { background:white; padding:40px; border-radius:10px; width:380px; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
      h2 { text-align:center; color:#333; margin-bottom:20px; }
      input, select { width:100%; padding:10px; margin:8px 0; border:1px solid #ddd; border-radius:5px; box-sizing:border-box; font-size:14px; }
      button { width:100%; padding:12px; background:#2196F3; color:white; border:none; border-radius:5px; font-size:16px; cursor:pointer; margin-top:10px; }
      button:hover { background:#1976D2; }
      .driver-fields { display:none; border-top:1px solid #eee; margin-top:10px; padding-top:10px; }
      label { font-size:12px; color:#888; margin-top:6px; display:block; }
      p { text-align:center; margin-top:15px; }
    </style></head>
    <body>
      <div class="box">
        <h2>Create Account</h2>
        <form method="POST" action="/register">

          <label>Full Name</label>
          <input type="text"     name="full_name" placeholder="Your full name"  required />

          <label>Email</label>
          <input type="email"    name="email"     placeholder="your@email.com"  required />

          <label>Phone</label>
          <input type="text"     name="phone"     placeholder="+923001234567"   required />

          <label>Password</label>
          <input type="password" name="password"  placeholder="Choose a password" required />

          <label>Register as</label>
          <select name="role" id="roleSelect" onchange="toggleDriverFields()">
            <option value="rider">Rider</option>
            <option value="driver">Driver</option>
          </select>

          <!-- These fields only show when role = driver -->
          <div class="driver-fields" id="driverFields">
            <label>License Number</label>
            <input type="text" name="license_number" placeholder="e.g. RWP-2024-001" />

            <label>CNIC</label>
            <input type="text" name="cnic" placeholder="e.g. 35201-1234567-1" />

            <label>Vehicle Make</label>
            <input type="text" name="make" placeholder="e.g. Suzuki" />

            <label>Vehicle Model</label>
            <input type="text" name="model" placeholder="e.g. Alto" />

            <label>Vehicle Year</label>
            <input type="text" name="manufacture_year" placeholder="e.g. 2020" />

            <label>Vehicle Color</label>
            <input type="text" name="color" placeholder="e.g. White" />

            <label>License Plate</label>
            <input type="text" name="license_plate" placeholder="e.g. RWP-123-AA" />

            <label>Vehicle Type</label>
            <select name="vehicle_type">
              <option value="economy">Economy</option>
              <option value="premium">Premium</option>
              <option value="bike">Bike</option>
            </select>
          </div>

          <button type="submit">Register</button>
        </form>
        <p><a href="/">Already have an account? Login</a></p>
      </div>

      <script>
        function toggleDriverFields() {
          var role   = document.getElementById('roleSelect').value;
          var fields = document.getElementById('driverFields');
          fields.style.display = (role === 'driver') ? 'block' : 'none';
        }
      </script>
    </body></html>
  `);
});


// ==========================================
// POST: Register
// Saves to users table, and if driver also saves to drivers + vehicles
// ==========================================
app.post('/register', (req, res) => {
  const {
    full_name, email, phone, password, role,
    license_number, cnic,
    make, model, manufacture_year, color, license_plate, vehicle_type
  } = req.body;

  // Step 1: Insert into users table
  const userSql = `
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES (?, ?, ?, SHA2(?, 256), ?)
  `;

  db.query(userSql, [full_name, email, phone, password, role], (err, result) => {
    if (err) {
      return res.send(`
        <h3 style="font-family:Arial;color:red;text-align:center">
          Error: ${err.message}
        </h3>
        <p style="text-align:center"><a href="/register">Go back</a></p>
      `);
    }

    const newUserId = result.insertId;

    // Step 2: If driver, also insert into drivers table
    if (role === 'driver') {
      const driverSql = `
        INSERT INTO drivers (driver_id, license_number, cnic, verification_status, availability_status)
        VALUES (?, ?, ?, 'pending', 'offline')
      `;

      db.query(driverSql, [newUserId, license_number, cnic], (err2) => {
        if (err2) {
          return res.send(`
            <h3 style="font-family:Arial;color:red;text-align:center">
              Driver Error: ${err2.message}
            </h3>
            <p style="text-align:center"><a href="/register">Go back</a></p>
          `);
        }

        // Step 3: Also insert vehicle if provided
        if (make && model && license_plate) {
          const vehicleSql = `
            INSERT INTO vehicles (driver_id, make, model, manufacture_year, color, license_plate, vehicle_type, verification_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
          `;
          db.query(vehicleSql, [newUserId, make, model, manufacture_year, color, license_plate, vehicle_type]);
        }

        res.redirect('/');
      });

    } else {
      // Rider — just redirect to login
      res.redirect('/');
    }
  });
});


// ==========================================
// POST: Login
// ==========================================
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // First fetch user regardless of status so we can give specific error messages
  const sql = `
    SELECT * FROM users
    WHERE email         = ?
      AND password_hash = SHA2(?, 256)
  `;

  db.query(sql, [email, password], (err, results) => {
    if (err) return res.send('Error: ' + err.message);

    if (results.length === 0) {
      return res.send(`
        <p style="font-family:Arial;text-align:center;color:red">
          Wrong email or password.
          <a href="/">Try again</a>
        </p>
      `);
    }

    const user = results[0];

    // Block banned users entirely
    if (user.account_status === 'banned') {
      return res.send(`
        <div style="font-family:Arial;text-align:center;margin-top:80px">
          <h2 style="color:red">🚫 Account Banned</h2>
          <p>Your account has been permanently banned.</p>
          <p>Please contact support if you believe this is a mistake.</p>
        </div>
      `);
    }

    // Block suspended users with a clear message
    if (user.account_status === 'suspended') {
      return res.send(`
        <div style="font-family:Arial;text-align:center;margin-top:80px">
          <h2 style="color:orange">⚠️ Account Suspended</h2>
          <p>Your account has been temporarily suspended.</p>
          <p>Please contact support for more information.</p>
          <a href="/" style="color:#2196F3">← Back to Login</a>
        </div>
      `);
    }

    req.session.user = user;

    // CRITICAL FIX: explicitly save session to disk before redirecting.
    // Without this, FileStore's async write may not complete before the
    // redirect fires — session appears empty on the very next request
    // and the middleware sends the user back to login immediately.
    req.session.save((saveErr) => {
      if (saveErr) return res.send('Session save error: ' + saveErr.message);
      if (user.role === 'admin')  return res.redirect('/admin');
      if (user.role === 'driver') return res.redirect('/driver');
      if (user.role === 'rider')  return res.redirect('/rider');
    });
  });
});


// ==========================================
// PAGE: Rider Dashboard
// ==========================================
app.get('/rider', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'rider') return res.redirect('/');

  const userId = req.session.user.user_id;
  const name   = req.session.user.full_name;
  const wallet = parseFloat(req.session.user.wallet_balance || 0).toFixed(2);

  const sql = `
    SELECT r.ride_id, r.fare, r.ride_status, r.request_time,
           r.driver_id,
           lp.city AS pickup_city, lp.area AS pickup_area,
           ld.city AS dropoff_city, ld.area AS dropoff_area,
           u.full_name AS driver_name, u.phone AS driver_phone,
           v.make, v.model, v.license_plate, v.vehicle_type,
           p.payment_method, p.payment_status
    FROM rides r
    JOIN locations lp       ON r.pickup_location_id  = lp.location_id
    JOIN locations ld       ON r.dropoff_location_id = ld.location_id
    LEFT JOIN users u       ON r.driver_id  = u.user_id
    LEFT JOIN vehicles v    ON r.vehicle_id = v.vehicle_id
    LEFT JOIN payments p    ON r.ride_id    = p.ride_id
    WHERE r.rider_id = ?
    ORDER BY r.request_time DESC
  `;

  db.query(sql, [userId], (err, rides) => {
    if (err) return res.send('Error: ' + err.message);

    let ridesHTML = rides.map(r => `
      <tr>
        <td>${r.ride_id}</td>
        <td>${r.pickup_city} - ${r.pickup_area}</td>
        <td>${r.dropoff_city} - ${r.dropoff_area}</td>
        <td>${r.driver_name
              ? `<b>${r.driver_name}</b><br><small style="color:#888">${r.driver_phone || ''}</small>`
              : '<span style="color:orange">Searching...</span>'}</td>
        <td>${r.make
              ? `${r.make} ${r.model}<br><small style="color:#888">${r.license_plate} | ${r.vehicle_type}</small>`
              : '---'}</td>
        <td><span style="color:${r.ride_status==='completed'?'green':r.ride_status==='cancelled'?'red':r.ride_status==='requested'?'orange':'#2196F3'}">${r.ride_status.charAt(0).toUpperCase()+r.ride_status.slice(1)}</span></td>
        <td>${r.fare ? 'Rs. ' + r.fare : '---'}</td>
        <td>${r.payment_method ? (r.payment_method.charAt(0).toUpperCase()+r.payment_method.slice(1)) + '<br><small style="color:#888">' + (r.payment_status ? r.payment_status.charAt(0).toUpperCase()+r.payment_status.slice(1) : '') + '</small>' : '---'}</td>
        <td>${new Date(r.request_time).toLocaleDateString()}</td>
        <td>
          ${r.ride_status === 'completed' && r.driver_name
            ? `<a href="/rate-ride/${r.ride_id}/${r.driver_id || ''}" style="background:#FF9800;color:white;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px;margin-right:4px">⭐ Rate</a>`
            : ''}
          <a href="/file-complaint/${r.ride_id}" style="background:#e53935;color:white;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px">📋 Complaint</a>
        </td>
      </tr>
    `).join('');

    res.send(`
      <html><head><title>Rider Dashboard</title>
      <meta http-equiv="refresh" content="5">
      <style>
        body { font-family:Arial; margin:0; background:#f5f5f5; }
        .header { background:#4CAF50; color:white; padding:15px 30px; display:flex; justify-content:space-between; align-items:center; }
        .content { padding:30px; }
        .cards { display:flex; gap:20px; margin-bottom:30px; }
        .card { background:white; padding:20px; border-radius:10px; flex:1; box-shadow:0 2px 5px rgba(0,0,0,0.1); }
        .card h3 { margin:0 0 5px 0; color:#888; font-size:14px; }
        .card p  { margin:0; font-size:28px; font-weight:bold; color:#333; }
        table { width:100%; background:white; border-radius:10px; border-collapse:collapse; box-shadow:0 2px 5px rgba(0,0,0,0.1); }
        th { background:#4CAF50; color:white; padding:12px; text-align:left; }
        td { padding:12px; border-bottom:1px solid #eee; }
        .book-form { background:white; padding:20px; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 5px rgba(0,0,0,0.1); }
        select { padding:8px; margin:5px; border:1px solid #ddd; border-radius:5px; width:220px; }
        .btn { background:#4CAF50; color:white; padding:10px 20px; border:none; border-radius:5px; cursor:pointer; font-size:14px; margin-left:5px; }
        h3 { color:#333; }
      </style></head>
      <body>
        <div class="header">
          <h2>🚗 RideFlow - Rider Dashboard</h2>
          <span>Hello, ${name} | Wallet: Rs. ${wallet} | <a href="/logout" style="color:white">Logout</a></span>
        </div>
        <div class="content">
          <div class="cards">
            <div class="card"><h3>Total Rides</h3><p>${rides.length}</p></div>
            <div class="card"><h3>Wallet Balance</h3><p>Rs. ${wallet}</p></div>
            <div class="card"><h3>Completed</h3><p>${rides.filter(r => r.ride_status === 'completed').length}</p></div>
          </div>

          <h3>Top Up Wallet</h3>
          <div class="book-form">
            <form method="POST" action="/topup-wallet" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <label style="font-size:13px;color:#555">Add Amount (Rs.):</label>
              <input type="number" name="amount" min="50" max="10000" placeholder="e.g. 500" style="padding:8px;border:1px solid #ddd;border-radius:5px;width:150px" required />
              <button type="submit" class="btn" style="background:#2196F3">Add to Wallet</button>
            </form>
          </div>

          <h3>Book a Ride</h3>
          <div class="book-form">
            <form method="POST" action="/book-ride">
              <label style="font-size:13px;color:#555">Pickup:</label>
              <select name="pickup_id">
                <option value="1">Rawalpindi - Saddar</option>
                <option value="2">Rawalpindi - Bahria Town</option>
                <option value="3">Islamabad - F-10</option>
                <option value="4">Islamabad - G-9</option>
                <option value="5">Lahore - DHA Phase 5</option>
                <option value="6">Lahore - Gulberg</option>
              </select>
              <label style="font-size:13px;color:#555">Dropoff:</label>
              <select name="dropoff_id">
                <option value="3">Islamabad - F-10</option>
                <option value="4">Islamabad - G-9</option>
                <option value="1">Rawalpindi - Saddar</option>
                <option value="2">Rawalpindi - Bahria Town</option>
                <option value="5">Lahore - DHA Phase 5</option>
                <option value="6">Lahore - Gulberg</option>
              </select>
              <label style="font-size:13px;color:#555">Payment:</label>
              <select name="payment_method">
                <option value="cash">Cash</option>
                <option value="wallet" ${parseFloat(wallet) <= 0 ? 'disabled' : ''}>
                  Wallet (Rs. ${wallet}) ${parseFloat(wallet) <= 0 ? '— empty, top up first' : ''}
                </option>
                <option value="card">Card</option>
              </select>
              <button type="submit" class="btn">Book Now</button>
            </form>
            <p style="font-size:12px;color:#888;margin-top:8px">
              💡 <b>Cash</b> = you pay the driver in person after the ride.<br>
              💡 <b>Wallet</b> = fare is deducted from your wallet automatically (must have balance).<br>
              💡 <b>Card</b> = pay by card after the ride.
            </p>
          </div>

          <h3>My Ride History</h3>
          <table>
            <tr>
              <th>Ride ID</th><th>Pickup</th><th>Dropoff</th>
              <th>Driver</th><th>Vehicle</th><th>Status</th><th>Fare</th><th>Payment</th><th>Date</th><th>Action</th>
            </tr>
            ${ridesHTML || '<tr><td colspan="9" style="text-align:center;padding:20px">No rides yet</td></tr>'}
          </table>
        </div>
      </body></html>
    `);
  });
});


// ==========================================
// POST: Top Up Wallet
// ==========================================
app.post('/topup-wallet', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'rider') return res.redirect('/');

  const amount  = parseFloat(req.body.amount);
  const userId  = req.session.user.user_id;

  if (isNaN(amount) || amount < 50) {
    return res.send('Minimum top-up is Rs. 50. <a href="/rider">Go back</a>');
  }

  // Force numeric: ROUND(CAST(wallet_balance AS DECIMAL(10,2)) + amount, 2)
  db.query(
    `UPDATE users SET wallet_balance = ROUND(CAST(wallet_balance AS DECIMAL(10,2)) + CAST(? AS DECIMAL(10,2)), 2) WHERE user_id = ?`,
    [amount, userId],
    (err) => {
      if (err) return res.send('Error: ' + err.message);
      db.query(`SELECT ROUND(wallet_balance, 2) AS wallet_balance FROM users WHERE user_id = ?`, [userId], (e, rows) => {
        if (!e && rows.length) req.session.user.wallet_balance = parseFloat(rows[0].wallet_balance).toFixed(2);
        res.redirect('/rider');
      });
    }
  );
});


// ==========================================
// POST: Book Ride
// ==========================================
app.post('/book-ride', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'rider') return res.redirect('/');

  const { pickup_id, dropoff_id, payment_method } = req.body;
  const rider_id = req.session.user.user_id;

  // Check 1: same location
  if (pickup_id === dropoff_id) {
    return res.send(`
      <p style="font-family:Arial;text-align:center;color:red;margin-top:50px">
        ❌ Pickup and dropoff cannot be the same!
      </p>
      <p style="text-align:center"><a href="/rider">Go back</a></p>
    `);
  }

  // Check 2: wallet payment — server-side hard block
  if (payment_method === 'wallet') {
    db.query(
      `SELECT u.wallet_balance,
              lp.latitude  AS p_lat, lp.longitude AS p_lon,
              ld.latitude  AS d_lat, ld.longitude AS d_lon
       FROM users u
       JOIN locations lp ON lp.location_id = ?
       JOIN locations ld ON ld.location_id = ?
       WHERE u.user_id = ?`,
      [pickup_id, dropoff_id, rider_id],
      (err, rows) => {
        if (err || !rows.length) return res.send('Error: ' + (err ? err.message : 'Location not found. <a href="/rider">Go back</a>'));

        const balance  = parseFloat(rows[0].wallet_balance);
        const pickupL  = { latitude: rows[0].p_lat, longitude: rows[0].p_lon };
        const dropoffL = { latitude: rows[0].d_lat, longitude: rows[0].d_lon };
        const estimated = calcFare(pickupL, dropoffL, 'economy', 1.0).fare;

        if (balance <= 0) {
          return res.send(`
            <div style="font-family:Arial;text-align:center;margin-top:80px;padding:20px">
              <h2 style="color:red">❌ Wallet is Empty</h2>
              <p>Your balance: <b>Rs. 0.00</b></p>
              <p>Top up your wallet or choose <b>Cash</b> / <b>Card</b> instead.</p>
              <a href="/rider" style="background:#4CAF50;color:white;padding:10px 20px;border-radius:5px;text-decoration:none;display:inline-block;margin-top:15px">← Go Back</a>
            </div>
          `);
        }

        if (balance < estimated) {
          return res.send(`
            <div style="font-family:Arial;text-align:center;margin-top:80px;padding:20px">
              <h2 style="color:red">❌ Insufficient Wallet Balance</h2>
              <p>Your balance: <b>Rs. ${balance.toFixed(2)}</b></p>
              <p>Estimated fare: <b>Rs. ${estimated}</b></p>
              <p style="color:#888;font-size:14px">You need at least <b>Rs. ${(estimated - balance).toFixed(2)}</b> more.</p>
              <a href="/rider" style="background:#4CAF50;color:white;padding:10px 20px;border-radius:5px;text-decoration:none;display:inline-block;margin-top:15px">← Go Back & Top Up</a>
            </div>
          `);
        }

        insertRide(rider_id, pickup_id, dropoff_id, payment_method, res);
      }
    );

  } else if (payment_method === 'cash' || payment_method === 'card') {
    // Cash/card — rider pays driver directly, no wallet needed
    insertRide(rider_id, pickup_id, dropoff_id, payment_method, res);

  } else {
    // Unknown payment method — block it
    return res.send('Invalid payment method. <a href="/rider">Go back</a>');
  }
});


// ==========================================
// HELPER: Insert ride + create payment record
// ==========================================
function insertRide(rider_id, pickup_id, dropoff_id, payment_method, res) {
  db.query(
    `INSERT INTO rides (rider_id, pickup_location_id, dropoff_location_id, ride_status) VALUES (?, ?, ?, 'requested')`,
    [rider_id, pickup_id, dropoff_id],
    (err, result) => {
      if (err) return res.send('Error booking ride: ' + err.message);

      const ride_id = result.insertId;

      // Payment is recorded with placeholder amount (real fare filled after trip)
      // amount=1 used as placeholder to pass CHECK(amount > 0)
      db.query(
        `INSERT INTO payments (ride_id, rider_id, amount, final_amount, payment_method, payment_status)
         VALUES (?, ?, 1, 1, ?, 'pending')`,
        [ride_id, rider_id, payment_method],
        (err2) => {
          if (err2) console.log('Payment record error:', err2.message);
          res.redirect('/rider');
        }
      );
    }
  );
}


// ==========================================
// PAGE: Driver Dashboard
// ==========================================
app.get('/driver', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'driver') return res.redirect('/');

  const driverId = req.session.user.user_id;
  const name     = req.session.user.full_name;

  // Fetch driver row + wallet balance from users table
  db.query(`SELECT * FROM drivers WHERE driver_id = ?`, [driverId], (err, driverRows) => {
    if (err || driverRows.length === 0) return res.send('Driver not found. <a href="/logout">Logout</a>');
    const driver = driverRows[0];

    db.query(`SELECT ROUND(wallet_balance, 2) AS wallet_balance FROM users WHERE user_id = ?`, [driverId], (errW, wRows) => {
    const driverWallet = (!errW && wRows.length) ? parseFloat(wRows[0].wallet_balance).toFixed(2) : '0.00';

    // Rides assigned to this driver (completed / cancelled history)
    const sqlRides = `
      SELECT r.ride_id, r.fare, r.ride_status, r.request_time,
             u.full_name AS rider_name, u.phone AS rider_phone,
             lp.city AS pickup_city, lp.area AS pickup_area,
             ld.city AS dropoff_city, ld.area AS dropoff_area
      FROM rides r
      JOIN users     u  ON r.rider_id            = u.user_id
      JOIN locations lp ON r.pickup_location_id  = lp.location_id
      JOIN locations ld ON r.dropoff_location_id = ld.location_id
      WHERE r.driver_id = ?
        AND r.ride_status IN ('completed', 'cancelled')
      ORDER BY r.request_time DESC
    `;

    // New incoming rides (not yet assigned to any driver)
    const sqlIncoming = `
      SELECT r.ride_id, r.ride_status, r.request_time,
             u.full_name AS rider_name, u.phone AS rider_phone,
             lp.city AS pickup_city, lp.area AS pickup_area,
             ld.city AS dropoff_city, ld.area AS dropoff_area
      FROM rides r
      JOIN users     u  ON r.rider_id            = u.user_id
      JOIN locations lp ON r.pickup_location_id  = lp.location_id
      JOIN locations ld ON r.dropoff_location_id = ld.location_id
      WHERE r.driver_id IS NULL
        AND r.ride_status = 'requested'
      ORDER BY r.request_time ASC
    `;

    // Rides accepted by this driver that are still in progress
    const sqlAccepted = `
      SELECT r.ride_id, r.ride_status, r.request_time,
             u.full_name AS rider_name, u.phone AS rider_phone,
             lp.city AS pickup_city, lp.area AS pickup_area,
             ld.city AS dropoff_city, ld.area AS dropoff_area,
             p.payment_method
      FROM rides r
      JOIN users     u  ON r.rider_id            = u.user_id
      JOIN locations lp ON r.pickup_location_id  = lp.location_id
      JOIN locations ld ON r.dropoff_location_id = ld.location_id
      LEFT JOIN payments p ON r.ride_id          = p.ride_id
      WHERE r.driver_id = ?
        AND r.ride_status = 'accepted'
      ORDER BY r.request_time ASC
    `;

    db.query(sqlRides, [driverId], (err2, rides) => {
      if (err2) return res.send('Error: ' + err2.message);

      db.query(sqlIncoming, (err3, incoming) => {
        if (err3) return res.send('Error: ' + err3.message);

        db.query(sqlAccepted, [driverId], (err4, accepted) => {
          if (err4) return res.send('Error: ' + err4.message);

          const isOnline    = driver.availability_status === 'online';
          const statusColor = isOnline ? 'green' : 'gray';

          // Show a warning if driver is pending verification
          const pendingWarning = driver.verification_status === 'pending'
            ? `<div style="background:#fff3cd;border:1px solid #ffc107;padding:12px 20px;border-radius:8px;margin-bottom:20px;color:#856404;">
                 ⚠️ Your account is pending verification by admin. You will be able to accept rides once verified.
               </div>`
            : '';

          // Completed / cancelled history rows
          let ridesHTML = rides.map(r => `
            <tr>
              <td>${r.ride_id}</td>
              <td>${r.rider_name}<br><small style="color:#888">${r.rider_phone||''}</small></td>
              <td>${r.pickup_city} - ${r.pickup_area}</td>
              <td>${r.dropoff_city} - ${r.dropoff_area}</td>
              <td><span style="color:${r.ride_status==='completed'?'green':r.ride_status==='cancelled'?'red':'#2196F3'}">${r.ride_status.charAt(0).toUpperCase()+r.ride_status.slice(1)}</span></td>
              <td>${r.fare ? 'Rs. ' + r.fare : '---'}</td>
            </tr>
          `).join('');

          // Incoming (unassigned) ride request rows
          let incomingHTML = incoming.map(r => `
            <tr style="background:#fffde7">
              <td>${r.ride_id}</td>
              <td><b>${r.rider_name}</b><br><small style="color:#888">${r.rider_phone||''}</small></td>
              <td>${r.pickup_city} - ${r.pickup_area}</td>
              <td>${r.dropoff_city} - ${r.dropoff_area}</td>
              <td>
                <a href="/driver/accept/${r.ride_id}" style="background:green;color:white;padding:5px 12px;border-radius:4px;text-decoration:none;margin-right:5px;font-size:13px">Accept</a>
                <a href="/driver/reject/${r.ride_id}" style="background:red;color:white;padding:5px 12px;border-radius:4px;text-decoration:none;font-size:13px">Reject</a>
              </td>
            </tr>
          `).join('');

          // Accepted / in-progress rides with Complete button
          let acceptedHTML = accepted.map(r => `
            <tr style="background:#e8f5e9">
              <td>${r.ride_id}</td>
              <td><b>${r.rider_name}</b><br><small style="color:#888">${r.rider_phone||''}</small></td>
              <td>${r.pickup_city} - ${r.pickup_area}</td>
              <td>${r.dropoff_city} - ${r.dropoff_area}</td>
              <td>${r.payment_method || '---'}</td>
              <td>
                <a href="/driver/complete/${r.ride_id}"
                   style="background:#4CAF50;color:white;padding:6px 14px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold"
                   onclick="return confirm('Mark ride #${r.ride_id} as completed?')">
                  ✅ Complete Ride
                </a>
              </td>
            </tr>
          `).join('');

          res.send(`
            <html><head><title>Driver Dashboard</title>
            <meta http-equiv="refresh" content="5">
            <style>
              body { font-family:Arial; margin:0; background:#f5f5f5; }
              .header { background:#2196F3; color:white; padding:15px 30px; display:flex; justify-content:space-between; align-items:center; }
              .content { padding:30px; }
              .cards { display:flex; gap:20px; margin-bottom:30px; flex-wrap:wrap; }
              .card { background:white; padding:20px; border-radius:10px; flex:1; box-shadow:0 2px 5px rgba(0,0,0,0.1); min-width:140px; }
              .card h3 { margin:0 0 5px 0; color:#888; font-size:14px; }
              .card p  { margin:0; font-size:26px; font-weight:bold; color:#333; }
              table { width:100%; background:white; border-radius:10px; border-collapse:collapse; box-shadow:0 2px 5px rgba(0,0,0,0.1); margin-bottom:25px; }
              th { background:#2196F3; color:white; padding:12px; text-align:left; }
              td { padding:12px; border-bottom:1px solid #eee; font-size:14px; }
              .btn { padding:10px 24px; border:none; border-radius:5px; cursor:pointer; font-size:14px; color:white; }
              .go-offline { background:gray; }
              .go-online  { background:green; }
              h3 { color:#333; }
              .refresh-note { font-size:12px; color:#888; margin-bottom:15px; }
              .th-incoming { background:#FF9800; }
              .th-accepted { background:#4CAF50; }
            </style></head>
            <body>
              <div class="header">
                <h2>🚗 RideFlow - Driver Dashboard</h2>
                <span>Hello, ${name} | ⭐ ${driver.avg_rating} | <a href="/logout" style="color:white">Logout</a></span>
              </div>
              <div class="content">
                ${pendingWarning}
                <p class="refresh-note">🔄 Page auto-refreshes every 5 seconds to show new ride requests.</p>

                <div class="cards">
                  <div class="card">
                    <h3>Status</h3>
                    <p style="color:${statusColor}">${driver.availability_status.charAt(0).toUpperCase()+driver.availability_status.slice(1)}</p>
                  </div>
                  <div class="card">
                    <h3>Total Trips</h3>
                    <p>${driver.total_trips}</p>
                  </div>
                  <div class="card">
                    <h3>Verification</h3>
                    <p style="font-size:15px;margin-top:5px">${driver.verification_status.charAt(0).toUpperCase()+driver.verification_status.slice(1)}</p>
                  </div>
                  <div class="card">
                    <h3>Avg Rating</h3>
                    <p>⭐ ${driver.avg_rating}</p>
                  </div>
                  <div class="card">
                    <h3>New Requests</h3>
                    <p style="color:${incoming.length > 0 ? 'orange' : '#333'}">${incoming.length}</p>
                  </div>
                  <div class="card">
                    <h3>Active Rides</h3>
                    <p style="color:${accepted.length > 0 ? 'green' : '#333'}">${accepted.length}</p>
                  </div>
                  <div class="card">
                    <h3>Wallet</h3>
                    <p style="color:#4CAF50;font-size:20px">Rs. ${driverWallet}</p>
                  </div>
                </div>

                <h3>Toggle Availability</h3>
                <form method="POST" action="/toggle-status" style="display:inline">
                  <button type="submit" class="btn ${isOnline ? 'go-offline' : 'go-online'}">
                    Go ${isOnline ? 'Offline' : 'Online'}
                  </button>
                </form>
                &nbsp;&nbsp;
                <a href="/driver/profile" style="background:#555;color:white;padding:10px 20px;border-radius:5px;text-decoration:none;font-size:14px">My Profile & Vehicle</a>
                <br><br>

                ${isOnline ? `
                <h3>🔔 New Ride Requests (${incoming.length})</h3>
                <table>
                  <tr>
                    <th class="th-incoming">Ride ID</th>
                    <th class="th-incoming">Rider</th>
                    <th class="th-incoming">Pickup</th>
                    <th class="th-incoming">Dropoff</th>
                    <th class="th-incoming">Action</th>
                  </tr>
                  ${incomingHTML || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#888">No new ride requests right now</td></tr>'}
                </table>
                ` : '<p style="color:gray;background:white;padding:15px;border-radius:8px">You are offline. Go online to see ride requests.</p>'}

                <h3>🚦 Active / In-Progress Rides (${accepted.length})</h3>
                <table>
                  <tr>
                    <th class="th-accepted">Ride ID</th>
                    <th class="th-accepted">Rider</th>
                    <th class="th-accepted">Pickup</th>
                    <th class="th-accepted">Dropoff</th>
                    <th class="th-accepted">Payment</th>
                    <th class="th-accepted">Action</th>
                  </tr>
                  ${acceptedHTML || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#888">No active rides</td></tr>'}
                </table>

                <h3>My Trip History</h3>
                <table>
                  <tr>
                    <th>Ride ID</th><th>Rider</th><th>Pickup</th>
                    <th>Dropoff</th><th>Status</th><th>Fare</th>
                  </tr>
                  ${ridesHTML || '<tr><td colspan="6" style="text-align:center;padding:20px">No trips yet</td></tr>'}
                </table>
              </div>
            </body></html>
          `);

        }); // end sqlAccepted
      }); // end sqlIncoming
    }); // end sqlRides
    }); // end wallet query
  });
});


// ==========================================
// DRIVER ACTION: Accept a ride
// ==========================================
app.get('/driver/accept/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'driver') return res.redirect('/');
  const driverId = req.session.user.user_id;

  // Find a verified vehicle for this driver
  db.query(`SELECT vehicle_id FROM vehicles WHERE driver_id = ? AND verification_status = 'verified' LIMIT 1`, [driverId], (err, vRows) => {
    if (err || vRows.length === 0) {
      return res.send('No verified vehicle found. <a href="/driver">Go back</a>');
    }
    const vehicleId = vRows[0].vehicle_id;

    db.query(
      `UPDATE rides SET driver_id = ?, vehicle_id = ?, ride_status = 'accepted' WHERE ride_id = ? AND driver_id IS NULL`,
      [driverId, vehicleId, req.params.id],
      (err2) => {
        if (err2) return res.send('Error: ' + err2.message);
        // Set driver to on_trip
        db.query(`UPDATE drivers SET availability_status = 'on_trip' WHERE driver_id = ?`, [driverId]);
        res.redirect('/driver');
      }
    );
  });
});


// ==========================================
// DRIVER ACTION: Complete a ride
// Sets ride_status = 'completed', calculates fare, marks payment as paid,
// increments driver total_trips, resets availability to online
// ==========================================
app.get('/driver/complete/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'driver') return res.redirect('/');

  const driverId = req.session.user.user_id;
  const rideId   = req.params.id;

  // Step 1: Confirm this ride belongs to this driver, fetch rider_id too
  db.query(
    `SELECT r.ride_id, r.rider_id, r.vehicle_id, v.vehicle_type, p.payment_method, p.payment_id
     FROM rides r
     JOIN vehicles v  ON r.vehicle_id = v.vehicle_id
     JOIN payments p  ON r.ride_id    = p.ride_id
     WHERE r.ride_id = ? AND r.driver_id = ? AND r.ride_status = 'accepted'`,
    [rideId, driverId],
    (err, rows) => {
      if (err)           return res.send('Error: ' + err.message + ' <a href="/driver">Go back</a>');
      if (!rows.length)  return res.send('Ride not found or already completed. <a href="/driver">Go back</a>');

      const ride          = rows[0];
      const vehicleType   = ride.vehicle_type;
      const paymentId     = ride.payment_id;
      const paymentMethod = ride.payment_method;
      const riderId       = ride.rider_id;   // ← needed for wallet deduction

      // Step 2: Calculate fare based on vehicle type
      const fareTable = { economy: 250, premium: 450, bike: 150 };
      const fare = fareTable[vehicleType] || 250;

      // Step 3: Mark ride completed, set fare
      db.query(
        `UPDATE rides
         SET ride_status      = 'completed',
             fare             = ?,
             duration_minutes = 25,
             distance_km      = 10
         WHERE ride_id = ?`,
        [fare, rideId],
        (err2) => {
          if (err2) return res.send('Error completing ride: ' + err2.message + ' <a href="/driver">Go back</a>');

          // Step 4: Update payment — set real fare and mark as paid
          db.query(
            `UPDATE payments
             SET amount         = ?,
                 final_amount   = ?,
                 payment_status = 'paid'
             WHERE payment_id = ?`,
            [fare, fare, paymentId],
            (err3) => {
              if (err3) return res.send('Error updating payment: ' + err3.message + ' <a href="/driver">Go back</a>');

              // Step 5: Deduct fare from rider's wallet regardless of payment method.
              // For wallet: direct deduction. For cash/card: no wallet change needed,
              // but we always deduct only when payment_method = 'wallet'.
              const doDeduction = (next) => {
                if (paymentMethod === 'wallet') {
                  // Use rider_id directly — no JOIN needed, no silent failures
                  db.query(
                    `UPDATE users
                     SET wallet_balance = GREATEST(0, ROUND(CAST(wallet_balance AS DECIMAL(10,2)) - CAST(? AS DECIMAL(10,2)), 2))
                     WHERE user_id = ?`,
                    [fare, riderId],
                    (errD) => {
                      if (errD) return res.send('Error deducting from rider wallet: ' + errD.message + ' <a href="/driver">Go back</a>');
                      next();
                    }
                  );
                } else {
                  // Cash or card — no wallet deduction needed
                  next();
                }
              };

              doDeduction(() => {
                // Step 6: Credit fare to driver's wallet
                db.query(
                  `UPDATE users
                   SET wallet_balance = ROUND(CAST(wallet_balance AS DECIMAL(10,2)) + CAST(? AS DECIMAL(10,2)), 2)
                   WHERE user_id = ?`,
                  [fare, driverId],
                  (err4) => {
                    if (err4) return res.send('Error crediting driver wallet: ' + err4.message + ' <a href="/driver">Go back</a>');

                    // Step 7: Increment driver total_trips, reset availability to online
                    db.query(
                      `UPDATE drivers
                       SET total_trips         = total_trips + 1,
                           availability_status = 'online'
                       WHERE driver_id = ?`,
                      [driverId],
                      (err5) => {
                        if (err5) return res.send('Error updating driver stats: ' + err5.message + ' <a href="/driver">Go back</a>');
                        res.redirect('/driver');
                      }
                    );
                  }
                );
              });
            }
          );
        }
      );
    }
  );
});


// ==========================================
// DRIVER ACTION: Reject a ride (skip it — stays unassigned for another driver)
// ==========================================
app.get('/driver/reject/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'driver') return res.redirect('/');
  // Simply redirect back — ride stays unassigned for another driver
  res.redirect('/driver');
});


// ==========================================
// POST: Toggle Driver Online / Offline status
// ==========================================
app.post('/toggle-status', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'driver') return res.redirect('/');
  db.query(
    `UPDATE drivers SET availability_status = IF(availability_status='online','offline','online') WHERE driver_id = ?`,
    [req.session.user.user_id],
    (err) => {
      if (err) return res.send('Error: ' + err.message);
      res.redirect('/driver');
    }
  );
});


// ==========================================
// PAGE: Driver Profile & Vehicle Details
// ==========================================
app.get('/driver/profile', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'driver') return res.redirect('/');

  const driverId = req.session.user.user_id;

  // Query 1: get user info (always exists)
  db.query(`SELECT * FROM users WHERE user_id = ?`, [driverId], (err, uRows) => {
    if (err) return res.send('Error getting user: ' + err.message + ' <a href="/driver">Go back</a>');
    if (uRows.length === 0) return res.send('User not found. <a href="/driver">Go back</a>');
    const user = uRows[0];

    // Query 2: get driver info (might not exist if not yet in drivers table)
    db.query(`SELECT * FROM drivers WHERE driver_id = ?`, [driverId], (err2, dRows) => {
      if (err2) return res.send('Error getting driver: ' + err2.message + ' <a href="/driver">Go back</a>');
      const driver = dRows[0] || null;  // null if not in drivers table yet

      // Query 3: get vehicles
      db.query(`SELECT * FROM vehicles WHERE driver_id = ?`, [driverId], (err3, vehicles) => {
        if (err3) return res.send('Error getting vehicles: ' + err3.message + ' <a href="/driver">Go back</a>');

        const vehicleRows = vehicles.map(v => `
          <tr>
            <td>${v.vehicle_id}</td>
            <td>${v.make} ${v.model}</td>
            <td>${v.manufacture_year}</td>
            <td>${v.color}</td>
            <td>${v.license_plate}</td>
            <td>${v.vehicle_type}</td>
            <td style="color:${v.verification_status === 'verified' ? 'green' : 'orange'}">${v.verification_status.charAt(0).toUpperCase()+v.verification_status.slice(1)}</td>
          </tr>
        `).join('');

        // Driver details section — show "not set" if driver row missing
        const driverSection = driver ? `
          <div class="row"><div class="label">License Number</div><div class="value">${driver.license_number}</div></div>
          <div class="row"><div class="label">CNIC</div><div class="value">${driver.cnic}</div></div>
          <div class="row">
            <div class="label">Verification</div>
            <div class="value" style="color:${driver.verification_status === 'verified' ? 'green' : driver.verification_status === 'rejected' ? 'red' : 'orange'}">
              ${driver.verification_status.charAt(0).toUpperCase()+driver.verification_status.slice(1)}
            </div>
          </div>
          <div class="row">
            <div class="label">Availability</div>
            <div class="value" style="color:${driver.availability_status === 'online' ? 'green' : 'gray'}">${driver.availability_status.charAt(0).toUpperCase()+driver.availability_status.slice(1)}</div>
          </div>
          <div class="row"><div class="label">Total Trips</div><div class="value">${driver.total_trips}</div></div>
          <div class="row"><div class="label">Average Rating</div><div class="value">⭐ ${driver.avg_rating}</div></div>
        ` : `<p style="color:orange">⚠️ Driver details not set up yet. Please contact admin.</p>`;

        const flagWarning = (driver && driver.is_flagged)
          ? `<div style="background:#fff3cd;border:1px solid #ffc107;padding:12px 16px;border-radius:8px;color:#856404;margin-bottom:20px">
               ⚠️ Your account has been flagged by admin. Please contact support.
             </div>`
          : '';

        res.send(`
          <html><head><title>My Profile</title>
          <style>
            body { font-family:Arial; margin:0; background:#f5f5f5; }
            .header { background:#2196F3; color:white; padding:15px 30px; display:flex; justify-content:space-between; align-items:center; }
            .content { padding:30px; max-width:900px; }
            .box { background:white; border-radius:10px; box-shadow:0 2px 5px rgba(0,0,0,0.1); margin-bottom:25px; }
            .box-title { background:#2196F3; color:white; padding:12px 20px; border-radius:10px 10px 0 0; font-size:15px; font-weight:bold; }
            .box-body { padding:20px; }
            .row { display:flex; border-bottom:1px solid #f0f0f0; padding:12px 0; }
            .row:last-child { border-bottom:none; }
            .label { width:200px; color:#888; font-size:14px; }
            .value { color:#333; font-size:14px; font-weight:bold; }
            table { width:100%; border-collapse:collapse; }
            th { background:#f5f5f5; padding:10px 12px; text-align:left; font-size:13px; color:#555; }
            td { padding:10px 12px; border-bottom:1px solid #eee; font-size:14px; }
          </style></head>
          <body>
            <div class="header">
              <h2>🚗 RideFlow - My Profile</h2>
              <a href="/driver" style="color:white">← Back to Dashboard</a>
            </div>
            <div class="content">
              ${flagWarning}

              <div class="box">
                <div class="box-title">👤 Personal Information</div>
                <div class="box-body">
                  <div class="row"><div class="label">Full Name</div><div class="value">${user.full_name}</div></div>
                  <div class="row"><div class="label">Email</div><div class="value">${user.email}</div></div>
                  <div class="row"><div class="label">Phone</div><div class="value">${user.phone}</div></div>
                  <div class="row"><div class="label">Wallet Balance</div><div class="value">Rs. ${user.wallet_balance || 0}</div></div>
                  <div class="row"><div class="label">Registered On</div><div class="value">${new Date(user.registration_date).toLocaleDateString()}</div></div>
                </div>
              </div>

              <div class="box">
                <div class="box-title">🪪 Driver Details</div>
                <div class="box-body">
                  ${driverSection}
                </div>
              </div>

              <div class="box">
                <div class="box-title">🚘 My Vehicles</div>
                <div class="box-body">
                  ${vehicles.length === 0
                    ? '<p style="color:#888;text-align:center;padding:10px">No vehicles registered yet.</p>'
                    : `<table>
                        <tr><th>ID</th><th>Make & Model</th><th>Year</th><th>Color</th><th>Plate</th><th>Type</th><th>Status</th></tr>
                        ${vehicleRows}
                       </table>`
                  }
                </div>
              </div>

            </div>
          </body></html>
        `);
      });
    });
  });
});


// ==========================================
// PAGE: Admin Panel
// ==========================================
app.get('/admin', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');

  const sqlUsers      = `SELECT user_id, full_name, email, role, account_status FROM users WHERE account_status = 'active' ORDER BY user_id DESC`;
  const sqlSuspended  = `SELECT user_id, full_name, email, role, account_status FROM users WHERE account_status = 'suspended' ORDER BY user_id DESC`;
  const sqlRevenue = `
    SELECT l.city, SUM(p.final_amount) AS total_revenue, COUNT(p.payment_id) AS total_rides
    FROM payments p
    JOIN rides     r ON p.ride_id            = r.ride_id
    JOIN locations l ON r.pickup_location_id = l.location_id
    WHERE p.payment_status = 'paid'
    GROUP BY l.city ORDER BY total_revenue DESC
  `;
  const sqlDrivers = `
    SELECT u.full_name, d.avg_rating, d.total_trips,
           d.availability_status, d.verification_status, d.is_flagged, d.driver_id
    FROM drivers d
    JOIN users u ON d.driver_id = u.user_id
    ORDER BY d.avg_rating DESC
  `;
  const sqlVehicles = `
    SELECT v.vehicle_id, v.make, v.model, v.license_plate,
           v.vehicle_type, v.color, v.manufacture_year,
           v.verification_status, u.full_name AS driver_name
    FROM vehicles v
    JOIN drivers d ON v.driver_id = d.driver_id
    JOIN users   u ON d.driver_id = u.user_id
    ORDER BY v.verification_status ASC
  `;
  // VIEW: ActiveRidesView — all currently active/requested rides (demonstrating view usage)
  const sqlActiveRidesView = `SELECT * FROM ActiveRidesView ORDER BY request_time DESC`;
  // VIEW: TopDriversView — verified drivers with avg_rating > 4.5 (demonstrating view usage)
  const sqlTopDriversView  = `SELECT * FROM TopDriversView ORDER BY avg_rating DESC`;
  // Full trip report INNER JOIN — Riders + Rides + Drivers + Vehicles
  const sqlTripReport = `
    SELECT r.ride_id, u_rider.full_name AS rider_name, u_driver.full_name AS driver_name,
           v.make, v.model, v.vehicle_type, lp.city AS pickup_city, ld.city AS dropoff_city,
           r.fare, r.ride_status, r.request_time
    FROM rides r
    INNER JOIN users     u_rider  ON r.rider_id            = u_rider.user_id
    INNER JOIN users     u_driver ON r.driver_id           = u_driver.user_id
    INNER JOIN vehicles  v        ON r.vehicle_id          = v.vehicle_id
    INNER JOIN locations lp       ON r.pickup_location_id  = lp.location_id
    INNER JOIN locations ld       ON r.dropoff_location_id = ld.location_id
    ORDER BY r.request_time DESC LIMIT 20
  `;
  // Admin notifications inserted by trigger when a driver is auto-flagged
  const sqlNotifications = `
    SELECT * FROM admin_notifications WHERE is_read = 0 ORDER BY created_at DESC LIMIT 10
  `;
  // Drivers with avg rating below 3.5 (HAVING aggregate query)
  const sqlLowRatedDrivers = `
    SELECT u.full_name AS driver_name, ROUND(AVG(rt.score),2) AS avg_score, COUNT(rt.rating_id) AS total_ratings
    FROM ratings rt
    JOIN users u ON rt.rated_user = u.user_id
    WHERE rt.rated_by_role = 'rider'
    GROUP BY rt.rated_user, u.full_name
    HAVING AVG(rt.score) < 3.5
  `;

  db.query(sqlUsers, (err, users) => {
    if (err) return res.send('Error: ' + err.message);
    db.query(sqlSuspended, (errS, suspended) => {
    if (errS) return res.send('Error: ' + errS.message);
    db.query(sqlRevenue, (err2, revenue) => {
      if (err2) return res.send('Error: ' + err2.message);
      db.query(sqlDrivers, (err3, drivers) => {
        if (err3) return res.send('Error: ' + err3.message);
        db.query(sqlVehicles, (err4, vehicles) => {
          if (err4) return res.send('Error: ' + err4.message);
          db.query(sqlActiveRidesView, (errA, activeRides) => {
            if (errA) activeRides = [];
          db.query(sqlTopDriversView, (errT, topDrivers) => {
            if (errT) topDrivers = [];
          db.query(sqlTripReport, (errR, tripReport) => {
            if (errR) tripReport = [];
          db.query(sqlNotifications, (errN, notifications) => {
            if (errN) notifications = [];
          db.query(sqlLowRatedDrivers, (errL, lowRated) => {
            if (errL) lowRated = [];

          const usersHTML = users.map(u => `
            <tr>
              <td>${u.user_id}</td>
              <td>${u.full_name}</td>
              <td>${u.email}</td>
              <td>${u.role}</td>
              <td><span style="color:green">active</span></td>
              <td>
                <a href="/admin/suspend/${u.user_id}" style="color:orange;margin-right:8px"
                   onclick="return confirm('Suspend ${u.full_name}?')">Suspend</a>
                <a href="/admin/ban/${u.user_id}" style="color:red"
                   onclick="return confirm('Permanently BAN ${u.full_name}? This cannot be undone easily.')">Ban</a>
              </td>
            </tr>
          `).join('');

          const suspendedHTML = suspended.map(u => `
            <tr style="background:#fff8e1">
              <td>${u.user_id}</td>
              <td>${u.full_name}</td>
              <td>${u.email}</td>
              <td>${u.role}</td>
              <td><span style="color:orange">suspended</span></td>
              <td>
                <a href="/admin/restore/${u.user_id}" style="color:green;margin-right:8px"
                   onclick="return confirm('Restore ${u.full_name} to active?')">✅ Restore</a>
                <a href="/admin/ban/${u.user_id}" style="color:red"
                   onclick="return confirm('Permanently BAN ${u.full_name}?')">🚫 Ban</a>
              </td>
            </tr>
          `).join('');

          const revenueHTML = revenue.map(r => `
            <tr>
              <td>${r.city}</td>
              <td>Rs. ${r.total_revenue}</td>
              <td>${r.total_rides}</td>
            </tr>
          `).join('');

          const driversHTML = drivers.map(d => `
            <tr>
              <td>${d.full_name}</td>
              <td>⭐ ${d.avg_rating}</td>
              <td>${d.total_trips}</td>
              <td>${d.availability_status.charAt(0).toUpperCase()+d.availability_status.slice(1)}</td>
              <td style="color:${d.verification_status==='verified'?'green':d.verification_status==='rejected'?'red':'orange'}">${d.verification_status.charAt(0).toUpperCase()+d.verification_status.slice(1)}</td>
              <td style="color:${d.is_flagged ? 'red':'green'}">${d.is_flagged ? '⚠️ Flagged':'OK'}</td>
              <td>
                ${d.verification_status !== 'verified' ? `<a href="/admin/verify/${d.driver_id}" style="color:green;margin-right:8px">Verify</a>` : '<span style="color:gray">Verified</span>'}
                ${d.is_flagged ? `| <a href="/admin/unflag/${d.driver_id}" style="color:blue">Unflag</a>` : ''}
              </td>
            </tr>
          `).join('');

          const vehiclesHTML = vehicles.map(v => `
            <tr>
              <td>${v.vehicle_id}</td>
              <td>${v.driver_name}</td>
              <td>${v.make} ${v.model}</td>
              <td>${v.color}</td>
              <td>${v.license_plate}</td>
              <td>${v.vehicle_type}</td>
              <td style="color:${v.verification_status==='verified'?'green':v.verification_status==='rejected'?'red':'orange'}">${v.verification_status.charAt(0).toUpperCase()+v.verification_status.slice(1)}</td>
              <td>
                ${v.verification_status !== 'verified'
                  ? `<a href="/admin/verify-vehicle/${v.vehicle_id}" style="color:green;margin-right:8px">Verify</a>`
                  : '<span style="color:gray">Verified</span>'}
                | <a href="/admin/reject-vehicle/${v.vehicle_id}" style="color:red">Reject</a>
              </td>
            </tr>
          `).join('');

          // ActiveRidesView output
          const activeRidesHTML = activeRides.map(r => `
            <tr>
              <td>${r.ride_id}</td>
              <td>${r.ride_status}</td>
              <td>${r.rider_name}</td>
              <td>${r.driver_name || '---'}</td>
              <td>${r.vehicle_type || '---'}</td>
              <td>${r.pickup_city} - ${r.pickup_area}</td>
              <td>${r.dropoff_city} - ${r.dropoff_area}</td>
            </tr>
          `).join('');

          // TopDriversView output
          const topDriversHTML = topDrivers.map(d => `
            <tr>
              <td>${d.driver_name}</td>
              <td>⭐ ${d.avg_rating}</td>
              <td>${d.total_trips}</td>
              <td style="color:${d.availability_status==='online'?'green':'gray'}">${d.availability_status}</td>
            </tr>
          `).join('');

          // Full INNER JOIN trip report
          const tripReportHTML = tripReport.map(r => `
            <tr>
              <td>${r.ride_id}</td>
              <td>${r.rider_name}</td>
              <td>${r.driver_name}</td>
              <td>${r.make} ${r.model}</td>
              <td>${r.vehicle_type}</td>
              <td>${r.pickup_city}</td>
              <td>${r.dropoff_city}</td>
              <td>${r.fare ? 'Rs. '+r.fare : '---'}</td>
              <td><span style="color:${r.ride_status==='completed'?'green':r.ride_status==='cancelled'?'red':'orange'}">${r.ride_status}</span></td>
              <td>${new Date(r.request_time).toLocaleDateString()}</td>
            </tr>
          `).join('');

          // Admin notifications from trigger
          const notifHTML = notifications.map(n => `
            <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:10px 15px;margin-bottom:8px;border-radius:4px;font-size:13px">
              🔔 <b>${n.notification_type.replace('_',' ').toUpperCase()}</b>: ${n.message}
              <span style="color:#888;float:right">${new Date(n.created_at).toLocaleString()}</span>
            </div>
          `).join('');

          // Low rated drivers from HAVING aggregate
          const lowRatedHTML = lowRated.map(d => `
            <tr style="background:#fff0f0">
              <td>${d.driver_name}</td>
              <td style="color:red">⭐ ${d.avg_score}</td>
              <td>${d.total_ratings}</td>
            </tr>
          `).join('');

          // Revenue chart data for Chart.js
          const chartLabels = JSON.stringify(revenue.map(r => r.city));
          const chartData   = JSON.stringify(revenue.map(r => r.total_revenue));
          const driverLabels = JSON.stringify(drivers.slice(0,8).map(d => d.full_name));
          const driverRatings = JSON.stringify(drivers.slice(0,8).map(d => d.avg_rating));

          res.send(`
            <html><head><title>Admin Panel</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
            <style>
              body { font-family:Arial; margin:0; background:#f5f5f5; }
              .header { background:#333; color:white; padding:15px 30px; display:flex; justify-content:space-between; align-items:center; }
              .content { padding:30px; }
              .nav-links { display:flex; gap:15px; margin-bottom:25px; flex-wrap:wrap; }
              .nav-links a { background:white; padding:10px 18px; border-radius:8px; text-decoration:none; color:#333; box-shadow:0 2px 5px rgba(0,0,0,0.1); font-size:13px; font-weight:bold; }
              .nav-links a:hover { background:#333; color:white; }
              .cards { display:flex; gap:20px; margin-bottom:30px; flex-wrap:wrap; }
              .card { background:white; padding:20px; border-radius:10px; flex:1; min-width:140px; box-shadow:0 2px 5px rgba(0,0,0,0.1); text-align:center; }
              .card h3 { margin:0 0 5px 0; color:#888; font-size:13px; }
              .card p  { margin:0; font-size:26px; font-weight:bold; color:#333; }
              h3 { color:#333; margin-top:30px; }
              table { width:100%; background:white; border-radius:10px; border-collapse:collapse; box-shadow:0 2px 5px rgba(0,0,0,0.1); margin-bottom:30px; }
              th { background:#333; color:white; padding:12px; text-align:left; font-size:13px; }
              td { padding:10px 12px; border-bottom:1px solid #eee; font-size:13px; }
              a { color:#2196F3; }
              .chart-row { display:flex; gap:20px; margin-bottom:30px; flex-wrap:wrap; }
              .chart-box { background:white; border-radius:10px; box-shadow:0 2px 5px rgba(0,0,0,0.1); padding:20px; flex:1; min-width:300px; }
              .badge-view { background:#4CAF50; color:white; font-size:11px; padding:2px 7px; border-radius:10px; margin-left:6px; }
            </style></head>
            <body>
              <div class="header">
                <h2>🛡️ RideFlow - Admin Panel</h2>
                <span><a href="/logout" style="color:white">Logout</a></span>
              </div>
              <div class="content">

                <div class="nav-links">
                  <a href="/admin/complaints">📋 Complaints</a>
                  <a href="/admin/fare-rules">⚙️ Fare Rules</a>
                  <a href="/admin/reports">📊 Full Reports</a>
                  <a href="/admin/mark-notifications-read">✅ Mark Notifications Read</a>
                </div>

                ${notifications.length > 0 ? `
                  <h3 style="color:red">🔔 Admin Notifications (${notifications.length} unread)</h3>
                  ${notifHTML}
                ` : ''}

                <div class="cards">
                  <div class="card"><h3>Total Users</h3><p>${users.length}</p></div>
                  <div class="card"><h3>Total Drivers</h3><p>${drivers.length}</p></div>
                  <div class="card"><h3>Flagged Drivers</h3><p style="color:red">${drivers.filter(d=>d.is_flagged).length}</p></div>
                  <div class="card"><h3>Active Rides</h3><p style="color:orange">${activeRides.length}</p></div>
                  <div class="card"><h3>Top Drivers (4.5+)</h3><p style="color:green">${topDrivers.length}</p></div>
                  <div class="card"><h3>Cities</h3><p>${revenue.length}</p></div>
                </div>

                <!-- ANALYTICS CHARTS -->
                <div class="chart-row">
                  <div class="chart-box">
                    <h3 style="margin-top:0">📊 Revenue by City</h3>
                    <canvas id="revenueChart" height="200"></canvas>
                  </div>
                  <div class="chart-box">
                    <h3 style="margin-top:0">⭐ Driver Ratings</h3>
                    <canvas id="ratingChart" height="200"></canvas>
                  </div>
                </div>
                <script>
                  (function(){
                    const rCtx = document.getElementById('revenueChart').getContext('2d');
                    new Chart(rCtx, {
                      type: 'bar',
                      data: {
                        labels: ${chartLabels},
                        datasets:[{ label:'Revenue (Rs.)', data:${chartData},
                          backgroundColor:['#4CAF50','#2196F3','#FF9800','#e53935','#9C27B0','#00BCD4'] }]
                      },
                      options:{ responsive:true, plugins:{ legend:{ display:false } } }
                    });
                    const dCtx = document.getElementById('ratingChart').getContext('2d');
                    new Chart(dCtx, {
                      type: 'bar',
                      data: {
                        labels: ${driverLabels},
                        datasets:[{ label:'Avg Rating', data:${driverRatings},
                          backgroundColor:'#FF9800' }]
                      },
                      options:{ responsive:true, indexAxis:'y',
                        scales:{ x:{ min:0, max:5 } },
                        plugins:{ legend:{ display:false } }
                      }
                    });
                  })();
                </script>

                <!-- VIEW: ActiveRidesView -->
                <h3>🟡 Active Rides View <span class="badge-view">DB VIEW</span></h3>
                <table>
                  <tr><th>Ride ID</th><th>Status</th><th>Rider</th><th>Driver</th><th>Vehicle Type</th><th>Pickup</th><th>Dropoff</th></tr>
                  ${activeRidesHTML || '<tr><td colspan="7" style="text-align:center;padding:15px;color:#888">No active rides right now</td></tr>'}
                </table>

                <!-- VIEW: TopDriversView -->
                <h3>🌟 Top Drivers (Rating > 4.5) <span class="badge-view">DB VIEW</span></h3>
                <table>
                  <tr><th>Driver Name</th><th>Avg Rating</th><th>Total Trips</th><th>Availability</th></tr>
                  ${topDriversHTML || '<tr><td colspan="4" style="text-align:center;padding:15px;color:#888">No top-rated drivers yet</td></tr>'}
                </table>

                <!-- AGGREGATE: Low Rated Drivers (HAVING < 3.5) -->
                <h3>⚠️ Low-Rated Drivers (Avg &lt; 3.5) <span style="background:#e53935;color:white;font-size:11px;padding:2px 7px;border-radius:10px;margin-left:6px">HAVING</span></h3>
                <table>
                  <tr><th>Driver Name</th><th>Avg Score</th><th>Total Ratings</th></tr>
                  ${lowRatedHTML || '<tr><td colspan="3" style="text-align:center;padding:15px;color:green">No low-rated drivers ✅</td></tr>'}
                </table>

                <!-- INNER JOIN: Full Trip Report -->
                <h3>📋 Full Trip Report <span style="background:#2196F3;color:white;font-size:11px;padding:2px 7px;border-radius:10px;margin-left:6px">INNER JOIN</span></h3>
                <table>
                  <tr><th>Ride ID</th><th>Rider</th><th>Driver</th><th>Vehicle</th><th>Type</th><th>Pickup</th><th>Dropoff</th><th>Fare</th><th>Status</th><th>Date</th></tr>
                  ${tripReportHTML || '<tr><td colspan="10" style="text-align:center;padding:15px">No rides yet</td></tr>'}
                </table>

                <h3>Revenue by City</h3>
                <table>
                  <tr><th>City</th><th>Total Revenue</th><th>Total Rides</th></tr>
                  ${revenueHTML || '<tr><td colspan="3" style="text-align:center;padding:15px">No payments yet</td></tr>'}
                </table>

                <h3>All Drivers</h3>
                <table>
                  <tr><th>Name</th><th>Rating</th><th>Trips</th><th>Status</th><th>Verified</th><th>Flag</th><th>Action</th></tr>
                  ${driversHTML || '<tr><td colspan="7" style="text-align:center;padding:15px">No drivers</td></tr>'}
                </table>

                <h3>All Vehicles</h3>
                <table>
                  <tr><th>ID</th><th>Driver</th><th>Vehicle</th><th>Color</th><th>Plate</th><th>Type</th><th>Status</th><th>Actions</th></tr>
                  ${vehiclesHTML || '<tr><td colspan="8" style="text-align:center;padding:15px">No vehicles</td></tr>'}
                </table>

                <h3>✅ Active Users</h3>
                <table>
                  <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
                  ${usersHTML || '<tr><td colspan="6" style="text-align:center;padding:15px">No active users</td></tr>'}
                </table>

                <h3>⚠️ Suspended Users</h3>
                <table>
                  <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
                  ${suspendedHTML || '<tr><td colspan="6" style="text-align:center;padding:15px;color:#888">No suspended users</td></tr>'}
                </table>
              </div>
            </body></html>
          `);
          }); // end lowRated
          }); // end notifications
          }); // end tripReport
          }); // end topDriversView
          }); // end activeRidesView
        }); // end sqlVehicles
      });
    });
    }); // end sqlSuspended
  });
});


// ==========================================
// ADMIN ACTIONS
// ==========================================

// Admin: verify a driver
app.get('/admin/verify/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE drivers SET verification_status = 'verified' WHERE driver_id = ?`, [req.params.id], () => {
    res.redirect('/admin');
  });
});

// Admin: unflag a driver
app.get('/admin/unflag/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE drivers SET is_flagged = 0 WHERE driver_id = ?`, [req.params.id], () => {
    res.redirect('/admin');
  });
});

// Admin: verify a vehicle
app.get('/admin/verify-vehicle/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE vehicles SET verification_status = 'verified' WHERE vehicle_id = ?`, [req.params.id], () => {
    res.redirect('/admin');
  });
});

// Admin: reject a vehicle
app.get('/admin/reject-vehicle/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE vehicles SET verification_status = 'rejected' WHERE vehicle_id = ?`, [req.params.id], () => {
    res.redirect('/admin');
  });
});

// Admin: suspend a user
app.get('/admin/suspend/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE users SET account_status = 'suspended' WHERE user_id = ?`, [req.params.id], () => {
    res.redirect('/admin');
  });
});

// Admin: ban a user
app.get('/admin/ban/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE users SET account_status = 'banned' WHERE user_id = ?`, [req.params.id], () => {
    res.redirect('/admin');
  });
});

// Admin: restore a suspended user back to active
app.get('/admin/restore/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE users SET account_status = 'active' WHERE user_id = ?`, [req.params.id], () => {
    res.redirect('/admin');
  });
});


// ==========================================
// PAGE: Rate a Ride (Rider rates Driver)
// ==========================================
app.get('/rate-ride/:ride_id/:driver_id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'rider') return res.redirect('/');
  const { ride_id, driver_id } = req.params;

  // Check if already rated
  db.query(
    `SELECT rating_id FROM ratings WHERE ride_id = ? AND rated_by_role = 'rider'`,
    [ride_id],
    (err, rows) => {
      if (err) return res.send('Error: ' + err.message);
      if (rows.length > 0) {
        return res.send(`
          <div style="font-family:Arial;text-align:center;margin-top:80px">
            <h3>You already rated this ride.</h3>
            <a href="/rider" style="background:#4CAF50;color:white;padding:10px 20px;border-radius:5px;text-decoration:none">Go Back</a>
          </div>
        `);
      }

      res.send(`
        <html><head><title>Rate Your Ride</title>
        <style>
          body{font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
          .box{background:white;padding:40px;border-radius:10px;width:380px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
          h2{text-align:center;color:#333;margin-bottom:20px}
          .stars{display:flex;gap:10px;justify-content:center;margin:20px 0;font-size:40px}
          .stars input{display:none}
          .stars label{cursor:pointer;color:#ddd;transition:color .2s}
          .stars input:checked ~ label,.stars label:hover,.stars label:hover ~ label{color:#FF9800}
          .stars{flex-direction:row-reverse}
          textarea{width:100%;padding:10px;border:1px solid #ddd;border-radius:5px;box-sizing:border-box;resize:vertical;height:100px;font-family:Arial;font-size:14px}
          button{width:100%;padding:12px;background:#FF9800;color:white;border:none;border-radius:5px;font-size:16px;cursor:pointer;margin-top:15px}
          label.star{font-size:36px}
        </style></head>
        <body>
          <div class="box">
            <h2>⭐ Rate Your Ride #${ride_id}</h2>
            <form method="POST" action="/rate-ride">
              <input type="hidden" name="ride_id"   value="${ride_id}" />
              <input type="hidden" name="driver_id" value="${driver_id}" />
              <p style="text-align:center;color:#555;margin-bottom:5px">How was your experience?</p>
              <div class="stars">
                <input type="radio" name="score" id="s5" value="5" required /><label for="s5" class="star">★</label>
                <input type="radio" name="score" id="s4" value="4" /><label for="s4" class="star">★</label>
                <input type="radio" name="score" id="s3" value="3" /><label for="s3" class="star">★</label>
                <input type="radio" name="score" id="s2" value="2" /><label for="s2" class="star">★</label>
                <input type="radio" name="score" id="s1" value="1" /><label for="s1" class="star">★</label>
              </div>
              <textarea name="comment" placeholder="Leave a comment (optional)..."></textarea>
              <button type="submit">Submit Rating</button>
            </form>
            <p style="text-align:center;margin-top:15px"><a href="/rider">Skip</a></p>
          </div>
        </body></html>
      `);
    }
  );
});

app.post('/rate-ride', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'rider') return res.redirect('/');
  const { ride_id, driver_id, score, comment } = req.body;
  const rider_id = req.session.user.user_id;

  db.query(
    `INSERT INTO ratings (ride_id, rated_by, rated_user, rated_by_role, score, comment)
     VALUES (?, ?, ?, 'rider', ?, ?)`,
    [ride_id, rider_id, driver_id, score, comment || null],
    (err) => {
      if (err) return res.send('Error saving rating: ' + err.message + ' <a href="/rider">Go back</a>');
      res.redirect('/rider');
    }
  );
});


// ==========================================
// PAGE: File a Complaint
// ==========================================
app.get('/file-complaint/:ride_id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const ride_id = req.params.ride_id;

  res.send(`
    <html><head><title>File Complaint</title>
    <style>
      body{font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
      .box{background:white;padding:40px;border-radius:10px;width:420px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
      h2{text-align:center;color:#e53935;margin-bottom:20px}
      select,textarea,input{width:100%;padding:10px;margin:8px 0;border:1px solid #ddd;border-radius:5px;box-sizing:border-box;font-family:Arial;font-size:14px}
      textarea{height:120px;resize:vertical}
      button{width:100%;padding:12px;background:#e53935;color:white;border:none;border-radius:5px;font-size:16px;cursor:pointer;margin-top:10px}
      label{font-size:13px;color:#555}
    </style></head>
    <body>
      <div class="box">
        <h2>📋 File a Complaint</h2>
        <form method="POST" action="/file-complaint">
          <input type="hidden" name="ride_id" value="${ride_id}" />
          <label>Complaint Type</label>
          <select name="complaint_type" required>
            <option value="">-- Select --</option>
            <option value="driver_behaviour">Driver Behaviour</option>
            <option value="rider_behaviour">Rider Behaviour</option>
            <option value="overcharging">Overcharging</option>
            <option value="safety">Safety Issue</option>
            <option value="payment_issue">Payment Issue</option>
            <option value="other">Other</option>
          </select>
          <label>Description</label>
          <textarea name="description" placeholder="Describe your issue in detail..." required></textarea>
          <button type="submit">Submit Complaint</button>
        </form>
        <p style="text-align:center;margin-top:15px"><a href="/rider">Cancel</a></p>
      </div>
    </body></html>
  `);
});

app.post('/file-complaint', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { ride_id, complaint_type, description } = req.body;
  const filed_by = req.session.user.user_id;

  db.query(
    `INSERT INTO complaints (filed_by, ride_id, complaint_type, description, status)
     VALUES (?, ?, ?, ?, 'open')`,
    [filed_by, ride_id || null, complaint_type, description],
    (err) => {
      if (err) return res.send('Error: ' + err.message + ' <a href="/rider">Go back</a>');
      res.send(`
        <div style="font-family:Arial;text-align:center;margin-top:80px">
          <h2 style="color:green">✅ Complaint Submitted!</h2>
          <p style="color:#555">Our admin team will review it shortly.</p>
          <a href="/rider" style="background:#4CAF50;color:white;padding:10px 20px;border-radius:5px;text-decoration:none;margin-top:20px;display:inline-block">Go Back</a>
        </div>
      `);
    }
  );
});


// ==========================================
// PAGE: Admin Fare Rules Config
// ==========================================
app.get('/admin/fare-rules', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');

  db.query(`SELECT * FROM fare_rules ORDER BY vehicle_type`, (err, rules) => {
    if (err) rules = [];

    const rulesHTML = rules.map(r => `
      <tr>
        <td>${r.vehicle_type}</td>
        <td>Rs. ${r.base_rate}</td>
        <td>Rs. ${r.per_km_rate}</td>
        <td>Rs. ${r.per_minute_rate}</td>
        <td>${r.surge_active ? r.surge_multiplier + 'x (ON)' : 'OFF'}</td>
        <td>
          <a href="/admin/fare-rules/edit/${r.rule_id}" style="background:#2196F3;color:white;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:13px">Edit</a>
        </td>
      </tr>
    `).join('');

    res.send(`
      <html><head><title>Fare Rules</title>
      <style>
        body{font-family:Arial;margin:0;background:#f5f5f5}
        .header{background:#333;color:white;padding:15px 30px;display:flex;justify-content:space-between;align-items:center}
        .content{padding:30px}
        table{width:100%;background:white;border-radius:10px;border-collapse:collapse;box-shadow:0 2px 5px rgba(0,0,0,0.1);margin-bottom:25px}
        th{background:#333;color:white;padding:12px;text-align:left}
        td{padding:12px;border-bottom:1px solid #eee;font-size:14px}
        .box{background:white;padding:25px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.1);max-width:500px}
        input,select{padding:8px;border:1px solid #ddd;border-radius:5px;width:200px;margin:5px}
        button{padding:10px 20px;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer;margin-top:10px}
        label{font-size:13px;color:#555;display:block;margin-top:10px}
      </style></head>
      <body>
        <div class="header">
          <h2>⚙️ Fare Rules Configuration</h2>
          <a href="/admin" style="color:white">← Back to Admin</a>
        </div>
        <div class="content">
          <h3 style="margin-bottom:15px">Current Fare Rules</h3>
          <table>
            <tr><th>Vehicle Type</th><th>Base Rate</th><th>Per KM</th><th>Per Minute</th><th>Surge</th><th>Action</th></tr>
            ${rulesHTML || '<tr><td colspan="6" style="text-align:center;padding:20px">No fare rules yet</td></tr>'}
          </table>

          <h3 style="margin-bottom:15px">Add New Fare Rule</h3>
          <div class="box">
            <form method="POST" action="/admin/fare-rules">
              <label>Vehicle Type</label>
              <select name="vehicle_type" required>
                <option value="economy">Economy</option>
                <option value="premium">Premium</option>
                <option value="bike">Bike</option>
              </select>
              <label>Base Rate (Rs.)</label>
              <input type="number" name="base_rate" step="0.01" placeholder="e.g. 50.00" required />
              <label>Per KM Rate (Rs.)</label>
              <input type="number" name="per_km_rate" step="0.01" placeholder="e.g. 25.00" required />
              <label>Per Minute Rate (Rs.)</label>
              <input type="number" name="per_minute_rate" step="0.01" placeholder="e.g. 3.00" required />
              <label>Surge Multiplier</label>
              <input type="number" name="surge_multiplier" step="0.1" value="1.0" placeholder="e.g. 1.5" required />
              <label>Surge Active?</label>
              <select name="surge_active">
                <option value="0">No</option>
                <option value="1">Yes</option>
              </select>
              <button type="submit">Save Rule</button>
            </form>
          </div>
        </div>
      </body></html>
    `);
  });
});

app.post('/admin/fare-rules', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  const { vehicle_type, base_rate, per_km_rate, per_minute_rate, surge_multiplier, surge_active } = req.body;

  db.query(
    `INSERT INTO fare_rules (vehicle_type, base_rate, per_km_rate, per_minute_rate, surge_multiplier, surge_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [vehicle_type, base_rate, per_km_rate, per_minute_rate, surge_multiplier, surge_active],
    (err) => {
      if (err) return res.send('Error: ' + err.message + ' <a href="/admin/fare-rules">Go back</a>');
      res.redirect('/admin/fare-rules');
    }
  );
});

// ==========================================
// ADMIN: Edit a fare rule (GET + POST)
// ==========================================
app.get('/admin/fare-rules/edit/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`SELECT * FROM fare_rules WHERE rule_id = ?`, [req.params.id], (err, rows) => {
    if (err || !rows.length) return res.send('Rule not found. <a href="/admin/fare-rules">Go back</a>');
    const r = rows[0];
    res.send(`
      <html><head><title>Edit Fare Rule</title>
      <style>
        body{font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
        .box{background:white;padding:40px;border-radius:10px;width:420px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
        h2{text-align:center;color:#333;margin-bottom:20px}
        input,select{width:100%;padding:10px;margin:6px 0;border:1px solid #ddd;border-radius:5px;box-sizing:border-box}
        label{font-size:13px;color:#555;display:block;margin-top:10px}
        button{width:100%;padding:12px;background:#4CAF50;color:white;border:none;border-radius:5px;font-size:16px;cursor:pointer;margin-top:15px}
      </style></head>
      <body>
        <div class="box">
          <h2>✏️ Edit Fare Rule</h2>
          <form method="POST" action="/admin/fare-rules/edit/${r.rule_id}">
            <label>Vehicle Type</label>
            <select name="vehicle_type">
              <option value="economy"  ${r.vehicle_type==='economy'?'selected':''}>Economy</option>
              <option value="premium"  ${r.vehicle_type==='premium'?'selected':''}>Premium</option>
              <option value="bike"     ${r.vehicle_type==='bike'?'selected':''}>Bike</option>
            </select>
            <label>Base Rate (Rs.)</label>
            <input type="number" name="base_rate" step="0.01" value="${r.base_rate}" required />
            <label>Per KM Rate (Rs.)</label>
            <input type="number" name="per_km_rate" step="0.01" value="${r.per_km_rate}" required />
            <label>Per Minute Rate (Rs.)</label>
            <input type="number" name="per_minute_rate" step="0.01" value="${r.per_minute_rate}" required />
            <label>Surge Multiplier</label>
            <input type="number" name="surge_multiplier" step="0.1" value="${r.surge_multiplier}" required />
            <label>Surge Active?</label>
            <select name="surge_active">
              <option value="0" ${!r.surge_active?'selected':''}>No</option>
              <option value="1" ${r.surge_active?'selected':''}>Yes</option>
            </select>
            <button type="submit">Update Rule</button>
          </form>
          <p style="text-align:center;margin-top:15px"><a href="/admin/fare-rules">Cancel</a></p>
        </div>
      </body></html>
    `);
  });
});

app.post('/admin/fare-rules/edit/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  const { vehicle_type, base_rate, per_km_rate, per_minute_rate, surge_multiplier, surge_active } = req.body;
  db.query(
    `UPDATE fare_rules SET vehicle_type=?, base_rate=?, per_km_rate=?, per_minute_rate=?, surge_multiplier=?, surge_active=? WHERE rule_id=?`,
    [vehicle_type, base_rate, per_km_rate, per_minute_rate, surge_multiplier, surge_active, req.params.id],
    (err) => {
      if (err) return res.send('Error: ' + err.message + ' <a href="/admin/fare-rules">Go back</a>');
      res.redirect('/admin/fare-rules');
    }
  );
});


// ==========================================
// PAGE: Admin view all Complaints
// ==========================================
app.get('/admin/complaints', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');

  db.query(`
    SELECT c.complaint_id, c.complaint_type, c.description, c.status, c.filed_date,
           u.full_name AS filed_by_name, c.ride_id
    FROM complaints c
    JOIN users u ON c.filed_by = u.user_id
    ORDER BY c.filed_date DESC
  `, (err, complaints) => {
    if (err) return res.send('Error: ' + err.message);

    const rows = complaints.map(c => `
      <tr>
        <td>${c.complaint_id}</td>
        <td>${c.filed_by_name}</td>
        <td>${c.ride_id || '---'}</td>
        <td>${c.complaint_type.replace('_', ' ')}</td>
        <td>${c.description.substring(0, 60)}...</td>
        <td><span style="color:${c.status==='open'?'orange':c.status==='resolved'?'green':'#888'}">${c.status}</span></td>
        <td>${new Date(c.filed_date).toLocaleDateString()}</td>
        <td>
          <a href="/admin/complaints/resolve/${c.complaint_id}" style="color:green;font-size:13px">Resolve</a> |
          <a href="/admin/complaints/dismiss/${c.complaint_id}" style="color:gray;font-size:13px">Dismiss</a>
        </td>
      </tr>
    `).join('');

    res.send(`
      <html><head><title>Complaints</title>
      <style>
        body{font-family:Arial;margin:0;background:#f5f5f5}
        .header{background:#333;color:white;padding:15px 30px;display:flex;justify-content:space-between;align-items:center}
        .content{padding:30px}
        table{width:100%;background:white;border-radius:10px;border-collapse:collapse;box-shadow:0 2px 5px rgba(0,0,0,0.1)}
        th{background:#333;color:white;padding:12px;text-align:left;font-size:13px}
        td{padding:10px 12px;border-bottom:1px solid #eee;font-size:13px}
      </style></head>
      <body>
        <div class="header">
          <h2>📋 All Complaints</h2>
          <a href="/admin" style="color:white">← Back to Admin</a>
        </div>
        <div class="content">
          <table>
            <tr><th>#</th><th>Filed By</th><th>Ride ID</th><th>Type</th><th>Description</th><th>Status</th><th>Date</th><th>Actions</th></tr>
            ${rows || '<tr><td colspan="8" style="text-align:center;padding:20px">No complaints yet</td></tr>'}
          </table>
        </div>
      </body></html>
    `);
  });
});

app.get('/admin/complaints/resolve/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE complaints SET status = 'resolved' WHERE complaint_id = ?`, [req.params.id], () => {
    res.redirect('/admin/complaints');
  });
});

app.get('/admin/complaints/dismiss/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE complaints SET status = 'dismissed' WHERE complaint_id = ?`, [req.params.id], () => {
    res.redirect('/admin/complaints');
  });
});


// ==========================================
// ADMIN: Mark all notifications as read
// ==========================================
app.get('/admin/mark-notifications-read', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
  db.query(`UPDATE admin_notifications SET is_read = 1 WHERE is_read = 0`, () => {
    res.redirect('/admin');
  });
});


// ==========================================
// ADMIN: Analytics / Reports page
// Shows LEFT JOIN (all riders including no rides), payment+promo JOIN,
// and aggregate driver stats
// ==========================================
app.get('/admin/reports', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');

  // LEFT JOIN: all riders including those who have never completed a ride
  const sqlRiderReport = `
    SELECT u.full_name AS rider_name, u.email,
           COUNT(r.ride_id) AS total_rides,
           COALESCE(SUM(r.fare), 0) AS total_spent
    FROM users u
    LEFT JOIN rides r ON u.user_id = r.rider_id AND r.ride_status = 'completed'
    WHERE u.role = 'rider'
    GROUP BY u.user_id, u.full_name, u.email
    ORDER BY total_rides DESC
  `;

  // JOIN payments + promo_codes: discount usage per ride
  const sqlPromoReport = `
    SELECT r.ride_id, u.full_name AS rider_name,
           p.amount AS original_fare, pc.code AS promo_used,
           p.promo_discount, p.final_amount,
           p.payment_method, p.payment_status
    FROM payments p
    JOIN      rides       r  ON p.ride_id  = r.ride_id
    JOIN      users       u  ON p.rider_id = u.user_id
    LEFT JOIN promo_codes pc ON p.promo_id = pc.promo_id
    ORDER BY r.ride_id
  `;

  // COUNT: trips per driver (aggregate)
  const sqlDriverTrips = `
    SELECT u.full_name AS driver_name, COUNT(r.ride_id) AS trips_completed
    FROM rides r
    JOIN users u ON r.driver_id = u.user_id
    WHERE r.ride_status = 'completed'
    GROUP BY r.driver_id, u.full_name
    ORDER BY trips_completed DESC
  `;

  db.query(sqlRiderReport, (e1, riders) => {
    if (e1) riders = [];
    db.query(sqlPromoReport, (e2, promos) => {
      if (e2) promos = [];
      db.query(sqlDriverTrips, (e3, driverTrips) => {
        if (e3) driverTrips = [];

        const riderRows = riders.map(r => `
          <tr>
            <td>${r.rider_name}</td>
            <td>${r.email}</td>
            <td>${r.total_rides}</td>
            <td>Rs. ${r.total_spent}</td>
          </tr>
        `).join('');

        const promoRows = promos.map(p => `
          <tr>
            <td>${p.ride_id}</td>
            <td>${p.rider_name}</td>
            <td>Rs. ${p.original_fare}</td>
            <td>${p.promo_used || '---'}</td>
            <td>Rs. ${p.promo_discount}</td>
            <td>Rs. ${p.final_amount}</td>
            <td>${p.payment_method}</td>
            <td style="color:${p.payment_status==='paid'?'green':'orange'}">${p.payment_status}</td>
          </tr>
        `).join('');

        const driverTripRows = driverTrips.map(d => `
          <tr>
            <td>${d.driver_name}</td>
            <td>${d.trips_completed}</td>
          </tr>
        `).join('');

        res.send(`
          <html><head><title>Reports</title>
          <style>
            body{font-family:Arial;margin:0;background:#f5f5f5}
            .header{background:#333;color:white;padding:15px 30px;display:flex;justify-content:space-between;align-items:center}
            .content{padding:30px}
            table{width:100%;background:white;border-radius:10px;border-collapse:collapse;box-shadow:0 2px 5px rgba(0,0,0,0.1);margin-bottom:30px}
            th{background:#333;color:white;padding:12px;text-align:left;font-size:13px}
            td{padding:10px 12px;border-bottom:1px solid #eee;font-size:13px}
            h3{color:#333;margin-top:25px}
            .badge{background:#2196F3;color:white;font-size:11px;padding:2px 7px;border-radius:10px;margin-left:6px}
          </style></head>
          <body>
            <div class="header">
              <h2>📊 RideFlow - Analytics & Reports</h2>
              <a href="/admin" style="color:white">← Back to Admin</a>
            </div>
            <div class="content">

              <h3>All Riders — Including Zero Rides <span class="badge">LEFT JOIN</span></h3>
              <table>
                <tr><th>Rider Name</th><th>Email</th><th>Total Rides</th><th>Total Spent</th></tr>
                ${riderRows || '<tr><td colspan="4" style="text-align:center;padding:15px">No riders</td></tr>'}
              </table>

              <h3>Payment & Promo Usage Report <span class="badge">LEFT JOIN + Payments</span></h3>
              <table>
                <tr><th>Ride ID</th><th>Rider</th><th>Original Fare</th><th>Promo</th><th>Discount</th><th>Final Amount</th><th>Method</th><th>Status</th></tr>
                ${promoRows || '<tr><td colspan="8" style="text-align:center;padding:15px">No payments</td></tr>'}
              </table>

              <h3>Trips Completed per Driver <span class="badge">COUNT + GROUP BY</span></h3>
              <table>
                <tr><th>Driver Name</th><th>Completed Trips</th></tr>
                ${driverTripRows || '<tr><td colspan="2" style="text-align:center;padding:15px">No trips</td></tr>'}
              </table>

            </div>
          </body></html>
        `);
      });
    });
  });
});


// ==========================================
// Logout
// ==========================================
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});


// ==========================================
// Start server
// ==========================================
app.listen(3000, () => {
  console.log('RideFlow is running!');
  console.log('Open: http://localhost:3000');
});