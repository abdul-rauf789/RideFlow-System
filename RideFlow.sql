CREATE DATABASE IF NOT EXISTS RideFlow;
USE RideFlow;	
CREATE TABLE users (
    user_id          INT          AUTO_INCREMENT PRIMARY KEY,
    full_name        VARCHAR(100) NOT NULL,
    email            VARCHAR(150) NOT NULL UNIQUE,
    phone            VARCHAR(15)  NOT NULL UNIQUE,
    password_hash    VARCHAR(255) NOT NULL,
    role             ENUM('admin', 'rider', 'driver') NOT NULL,
    account_status   ENUM('active', 'suspended', 'banned') NOT NULL DEFAULT 'active',
    registration_date DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE locations (
    location_id  INT           AUTO_INCREMENT PRIMARY KEY,
    city         VARCHAR(100)  NOT NULL,
    area         VARCHAR(150)  NOT NULL,
    latitude     DECIMAL(10,8) NOT NULL,
    longitude    DECIMAL(11,8) NOT NULL,
 
    CHECK (latitude  BETWEEN -90  AND  90),
    CHECK (longitude BETWEEN -180 AND 180)
);
CREATE TABLE drivers (
    driver_id           INT         PRIMARY KEY,
    license_number      VARCHAR(50) NOT NULL UNIQUE,
    cnic                VARCHAR(15) NOT NULL UNIQUE,
    verification_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
    availability_status ENUM('online', 'offline', 'on_trip')    NOT NULL DEFAULT 'offline',
    total_trips         INT         NOT NULL DEFAULT 0,
    avg_rating          DECIMAL(3,2) NOT NULL DEFAULT 0.00,
 
    CHECK (avg_rating BETWEEN 0.00 AND 5.00),
 
    FOREIGN KEY (driver_id) REFERENCES users(user_id)
);
CREATE TABLE vehicles (
    vehicle_id          INT          AUTO_INCREMENT PRIMARY KEY,
    driver_id           INT          NOT NULL,
    make                VARCHAR(60)  NOT NULL,
    model               VARCHAR(60)  NOT NULL,
    manufacture_year    YEAR         NOT NULL,
    color               VARCHAR(30)  NOT NULL,
    license_plate       VARCHAR(20)  NOT NULL UNIQUE,
    vehicle_type        ENUM('economy', 'premium', 'bike') NOT NULL,
    verification_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
 
    FOREIGN KEY (driver_id) REFERENCES drivers(driver_id)
);
CREATE TABLE promo_codes (
    promo_id       INT           AUTO_INCREMENT PRIMARY KEY,
    code           VARCHAR(30)   NOT NULL UNIQUE,
    discount_type  ENUM('percentage', 'flat') NOT NULL,
    discount_value DECIMAL(8,2)  NOT NULL,
    expiry_date    DATE          NOT NULL,
    usage_limit    INT           NOT NULL DEFAULT 1,
    times_used     INT           NOT NULL DEFAULT 0,
    is_active      INT           NOT NULL DEFAULT 1,
 
    CHECK (discount_value > 0),
    CHECK (times_used <= usage_limit)
);
CREATE TABLE rides (
    ride_id              INT           AUTO_INCREMENT PRIMARY KEY,
    rider_id             INT           NOT NULL,
    driver_id            INT           NULL,
    vehicle_id           INT           NULL,
    pickup_location_id   INT           NOT NULL,
    dropoff_location_id  INT           NOT NULL,
    ride_status          ENUM('requested','accepted','driver_en_route',
                              'in_progress','completed','cancelled')
                                       NOT NULL DEFAULT 'requested',
    fare                 DECIMAL(10,2) NULL,
    distance_km          DECIMAL(8,3)  NULL,
    duration_minutes     INT           NULL,
    request_time         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    scheduled_time       DATETIME      NULL,
 
    CHECK (fare IS NULL OR fare >= 0),
    CHECK (pickup_location_id <> dropoff_location_id),
 
    FOREIGN KEY (rider_id)            REFERENCES users(user_id),
    FOREIGN KEY (driver_id)           REFERENCES drivers(driver_id),
    FOREIGN KEY (vehicle_id)          REFERENCES vehicles(vehicle_id),
    FOREIGN KEY (pickup_location_id)  REFERENCES locations(location_id),
    FOREIGN KEY (dropoff_location_id) REFERENCES locations(location_id)
);
 CREATE TABLE payments (
    payment_id       INT           AUTO_INCREMENT PRIMARY KEY,
    ride_id          INT           NOT NULL UNIQUE,
    rider_id         INT           NOT NULL,
    promo_id         INT           NULL,
    amount           DECIMAL(10,2) NOT NULL,
    promo_discount   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    final_amount     DECIMAL(10,2) NOT NULL,
    payment_method   ENUM('cash', 'wallet', 'card') NOT NULL,
    payment_status   ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    transaction_date DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
 
    CHECK (amount > 0),
    CHECK (promo_discount >= 0),
    CHECK (final_amount >= 0),
 
    FOREIGN KEY (ride_id)  REFERENCES rides(ride_id),
    FOREIGN KEY (rider_id) REFERENCES users(user_id),
    FOREIGN KEY (promo_id) REFERENCES promo_codes(promo_id)
);
CREATE TABLE ratings (
    rating_id    INT          AUTO_INCREMENT PRIMARY KEY,
    ride_id      INT          NOT NULL,
    rated_by     INT          NOT NULL,
    rated_user   INT          NOT NULL,
    rated_by_role ENUM('rider', 'driver') NOT NULL,
    score        TINYINT      NOT NULL,
    comment      VARCHAR(500) NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
 
    UNIQUE (ride_id, rated_by_role),
 
    CHECK (score BETWEEN 1 AND 5),
    CHECK (rated_by <> rated_user),
 
    FOREIGN KEY (ride_id)    REFERENCES rides(ride_id),
    FOREIGN KEY (rated_by)   REFERENCES users(user_id),
    FOREIGN KEY (rated_user) REFERENCES users(user_id)
);
CREATE TABLE complaints (
    complaint_id   INT        AUTO_INCREMENT PRIMARY KEY,
    filed_by       INT        NOT NULL,
    against_user   INT        NULL,
    ride_id        INT        NULL,
    complaint_type ENUM('driver_behaviour', 'rider_behaviour', 'overcharging',
                        'safety', 'payment_issue', 'other') NOT NULL,
    description    TEXT       NOT NULL,
    status         ENUM('open', 'under_review', 'resolved', 'dismissed')
                              NOT NULL DEFAULT 'open',
    filed_date     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
 
    FOREIGN KEY (filed_by)     REFERENCES users(user_id),
    FOREIGN KEY (against_user) REFERENCES users(user_id),
    FOREIGN KEY (ride_id)      REFERENCES rides(ride_id)
);

-- Inserting Data--
INSERT INTO users (full_name, email, phone, password_hash, role) VALUES
('Admin User',   'admin@rideflow.pk',  '+923000000001', SHA2('admin123',  256), 'admin'),
('Ali Hassan',   'ali@rider.pk',       '+923000000002', SHA2('rider123',  256), 'rider'),
('Sara Khan',    'sara@rider.pk',      '+923000000003', SHA2('rider456',  256), 'rider'),
('Umar Farooq',  'umar@driver.pk',     '+923000000004', SHA2('driver123', 256), 'driver'),
('Zainab Malik', 'zainab@driver.pk',   '+923000000005', SHA2('driver456', 256), 'driver'),
('Bilal Ahmed',  'bilal@rider.pk',     '+923000000006', SHA2('rider789',  256), 'rider');

INSERT INTO locations (city, area, latitude, longitude) VALUES
('Rawalpindi', 'Saddar',      33.59770000,  73.04580000),
('Rawalpindi', 'Bahria Town', 33.52980000,  73.19670000),
('Islamabad',  'F-10',        33.70800000,  73.02250000),
('Islamabad',  'G-9',         33.69620000,  73.05130000),
('Lahore',     'DHA Phase 5', 31.47260000,  74.40130000),
('Lahore',     'Gulberg',     31.51200000,  74.35800000);

INSERT INTO drivers (driver_id, license_number, cnic, verification_status, availability_status) VALUES
(4, 'RWP-2021-001', '35201-1234567-1', 'verified', 'online'),
(5, 'ISB-2020-002', '61101-9876543-2', 'verified', 'offline');

INSERT INTO vehicles (driver_id, make, model, manufacture_year, color, license_plate, vehicle_type, verification_status) VALUES
(4, 'Suzuki', 'Alto',    2020, 'White',  'RWP-123-AA', 'economy', 'verified'),
(4, 'Honda',  'CD 70',   2022, 'Black',  'RWP-456-BB', 'bike',    'verified'),
(5, 'Toyota', 'Corolla', 2019, 'Silver', 'ISB-789-CC', 'premium', 'verified');

INSERT INTO promo_codes (code, discount_type, discount_value, expiry_date, usage_limit) VALUES
('WELCOME50', 'flat',       50.00, '2026-12-31', 1000),
('SAVE20',    'percentage', 20.00, '2026-06-30',  500),
('EXPIRED10', 'flat',       10.00, '2025-01-01',   50);

INSERT INTO rides (rider_id, driver_id, vehicle_id, pickup_location_id, dropoff_location_id, ride_status, fare, distance_km, duration_minutes) VALUES
(2, 4, 1, 1, 3, 'completed', 250.00, 12.5, 30),
(3, 4, 1, 3, 4, 'completed', 180.00,  8.0, 20),
(2, 5, 3, 5, 6, 'completed', 320.00, 15.0, 35),
(6, 4, 2, 2, 1, 'completed', 150.00,  6.0, 15),
(3, 5, 3, 5, 6, 'cancelled',   NULL,  NULL, NULL),
(2, 4, 1, 1, 2, 'requested',   NULL,  NULL, NULL);

INSERT INTO payments (ride_id, rider_id, promo_id, amount, promo_discount, final_amount, payment_method, payment_status) VALUES
(1, 2, NULL, 250.00,  0.00, 250.00, 'cash',   'paid'),
(2, 3,    1, 180.00, 50.00, 130.00, 'wallet', 'paid'),
(3, 2, NULL, 320.00,  0.00, 320.00, 'card',   'paid'),
(4, 6, NULL, 150.00,  0.00, 150.00, 'cash',   'paid');

INSERT INTO ratings (ride_id, rated_by, rated_user, rated_by_role, score, comment) VALUES
(1, 2, 4, 'rider',  5, 'Great driver!'),
(1, 4, 2, 'driver', 4, 'Good rider'),
(2, 3, 4, 'rider',  3, 'Okay ride'),
(2, 4, 3, 'driver', 5, 'Very polite'),
(3, 2, 5, 'rider',  4, 'Smooth ride'),
(4, 6, 4, 'rider',  2, 'Late pickup');

-- INDEXES

CREATE INDEX idx_rider_id        ON rides(rider_id);
CREATE INDEX idx_driver_id       ON rides(driver_id);
CREATE INDEX idx_ride_status     ON rides(ride_status);
CREATE INDEX idx_locations_city  ON locations(city);

-- VIEWS

-- View 1: All active (non-completed, non-cancelled) rides with full details
CREATE VIEW ActiveRidesView AS
SELECT
    r.ride_id,
    r.ride_status,
    u_rider.full_name   AS rider_name,
    u_rider.phone       AS rider_phone,
    u_driver.full_name  AS driver_name,
    v.license_plate,
    v.vehicle_type,
    lp.city             AS pickup_city,
    lp.area             AS pickup_area,
    ld.city             AS dropoff_city,
    ld.area             AS dropoff_area,
    r.request_time
FROM rides r
JOIN users     u_rider  ON r.rider_id            = u_rider.user_id
JOIN users     u_driver ON r.driver_id           = u_driver.user_id
JOIN vehicles  v        ON r.vehicle_id          = v.vehicle_id
JOIN locations lp       ON r.pickup_location_id  = lp.location_id
JOIN locations ld       ON r.dropoff_location_id = ld.location_id
WHERE r.ride_status NOT IN ('completed', 'cancelled');

-- View 2: Drivers with average rating above 4.5 (verified only)
CREATE VIEW TopDriversView AS
SELECT
    u.user_id,
    u.full_name           AS driver_name,
    d.avg_rating,
    d.total_trips,
    d.availability_status
FROM drivers d
JOIN users u ON d.driver_id = u.user_id
WHERE d.avg_rating > 4.5 AND d.verification_status = 'verified';

-- STORED PROCEDURE: CalculateFare
-- Auto-calculates fare using distance, duration, and surge multiplier
-- Handles economy, premium, and bike vehicle types
DELIMITER $$

CREATE PROCEDURE CalculateFare(
    IN  p_ride_id      INT,
    IN  p_distance_km  DECIMAL(8,3),
    IN  p_duration_min INT,
    IN  p_surge        DECIMAL(4,2)
)
BEGIN
    DECLARE v_vehicle_type VARCHAR(20);
    DECLARE v_base_rate    DECIMAL(8,2);
    DECLARE v_per_km       DECIMAL(8,2);
    DECLARE v_per_min      DECIMAL(8,2);
    DECLARE v_fare         DECIMAL(10,2);

    SELECT v.vehicle_type INTO v_vehicle_type
    FROM rides r
    JOIN vehicles v ON v.vehicle_id = r.vehicle_id
    WHERE r.ride_id = p_ride_id;

    IF v_vehicle_type = 'economy' THEN
        SET v_base_rate = 50.00;
        SET v_per_km    = 25.00;
        SET v_per_min   = 3.00;
    ELSEIF v_vehicle_type = 'premium' THEN
        SET v_base_rate = 100.00;
        SET v_per_km    = 45.00;
        SET v_per_min   = 5.00;
    ELSE  -- bike
        SET v_base_rate = 30.00;
        SET v_per_km    = 12.00;
        SET v_per_min   = 1.50;
    END IF;

    -- Fare = (Base + Per_KM x Distance + Per_Min x Duration) x Surge
    SET v_fare = (v_base_rate + (v_per_km * p_distance_km) + (v_per_min * p_duration_min)) * p_surge;

    UPDATE rides
    SET fare             = ROUND(v_fare, 2),
        distance_km      = p_distance_km,
        duration_minutes = p_duration_min
    WHERE ride_id = p_ride_id;

    SELECT ROUND(v_fare, 2) AS calculated_fare;
END$$

DELIMITER ;


-- TRIGGERS
DELIMITER $$

-- Trigger 1: When payment is marked PAID → automatically set ride to COMPLETED
CREATE TRIGGER trg_payment_completes_ride
AFTER UPDATE ON payments
FOR EACH ROW
BEGIN
    IF NEW.payment_status = 'paid' AND OLD.payment_status != 'paid' THEN
        UPDATE rides
        SET ride_status = 'completed'
        WHERE ride_id = NEW.ride_id;
    END IF;
END$$

-- Trigger 2: After a rider rates a driver:
--   - Recalculate and update driver's avg_rating
--   - If avg drops below 3.5: flag driver AND insert admin notification
CREATE TRIGGER trg_update_driver_rating
AFTER INSERT ON ratings
FOR EACH ROW
BEGIN
    DECLARE v_avg DECIMAL(3,2);

    IF NEW.rated_by_role = 'rider' THEN

        SELECT ROUND(AVG(score), 2) INTO v_avg
        FROM ratings
        WHERE rated_user    = NEW.rated_user
          AND rated_by_role = 'rider';

        UPDATE drivers
        SET avg_rating = v_avg
        WHERE driver_id = NEW.rated_user;

        -- Flag driver and INSERT admin notification when avg drops below 3.5
        IF v_avg < 3.5 THEN
            UPDATE drivers
            SET is_flagged = 1
            WHERE driver_id = NEW.rated_user;

            -- Admin notification: insert into admin_notifications table
            INSERT INTO admin_notifications (notification_type, message, is_read)
            VALUES (
                'driver_flagged',
                CONCAT('Driver ID ', NEW.rated_user, ' has been auto-flagged. Average rating dropped to ', v_avg),
                0
            );
        END IF;

    END IF;
END$$

-- Trigger 3: When a promo code is used in a payment → increment usage counter
CREATE TRIGGER trg_increment_promo_usage
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
    IF NEW.promo_id IS NOT NULL THEN
        UPDATE promo_codes
        SET times_used = times_used + 1
        WHERE promo_id = NEW.promo_id;
    END IF;
END$$

DELIMITER ;

-- EVENT: Expire promo codes daily at midnight
SET GLOBAL event_scheduler = ON;

CREATE EVENT expire_promo_codes
ON SCHEDULE EVERY 1 DAY
STARTS '2026-01-01 00:00:00'
DO
    UPDATE promo_codes
    SET    is_active = 0
    WHERE  expiry_date < CURDATE()
      AND  is_active   = 1;

-- BASIC SQL QUERIES (Component 1)

-- Query 1: All completed rides for a specific rider, ordered by date DESC
SELECT
    r.ride_id,
    r.fare,
    r.request_time,
    lp.city AS pickup_city,
    ld.city AS dropoff_city
FROM rides r
JOIN locations lp ON r.pickup_location_id  = lp.location_id
JOIN locations ld ON r.dropoff_location_id = ld.location_id
WHERE r.rider_id    = 2
  AND r.ride_status = 'completed'
ORDER BY r.request_time DESC;

-- Query 2: All verified drivers in a specific city ordered by rating DESC
SELECT DISTINCT
    u.full_name           AS driver_name,
    d.avg_rating,
    d.availability_status,
    lp.city
FROM drivers d
JOIN users     u   ON d.driver_id           = u.user_id
JOIN rides     r   ON r.driver_id           = d.driver_id
JOIN locations lp  ON r.pickup_location_id  = lp.location_id
WHERE lp.city = 'Rawalpindi'
  AND d.verification_status = 'verified'
ORDER BY d.avg_rating DESC;

-- AGGREGATE FUNCTIONS + HAVING (Component 2)

-- Total revenue per city (SUM)
SELECT l.city, SUM(p.final_amount) AS total_revenue
FROM payments p
JOIN rides     r ON p.ride_id            = r.ride_id
JOIN locations l ON r.pickup_location_id = l.location_id
WHERE p.payment_status = 'paid'
GROUP BY l.city
ORDER BY total_revenue DESC;

-- Drivers with average score below 3.5 (AVG + HAVING)
SELECT u.full_name AS driver_name, AVG(rt.score) AS avg_score, COUNT(rt.rating_id) AS total_ratings
FROM ratings rt
JOIN users u ON rt.rated_user = u.user_id
WHERE rt.rated_by_role = 'rider'
GROUP BY rt.rated_user, u.full_name
HAVING AVG(rt.score) < 3.5;

-- Number of completed trips per driver (COUNT)
SELECT u.full_name AS driver_name, COUNT(r.ride_id) AS trips_completed
FROM rides r
JOIN users u ON r.driver_id = u.user_id
WHERE r.ride_status = 'completed'
GROUP BY r.driver_id, u.full_name
ORDER BY trips_completed DESC;

-- JOINS FOR REPORTS (Component 3)

-- INNER JOIN: Full trip report — Riders, Rides, Drivers, Vehicles, Locations
SELECT r.ride_id, u_rider.full_name   AS rider_name, u_driver.full_name  AS driver_name,
       v.make, v.model, v.vehicle_type, lp.city AS pickup_city, ld.city AS dropoff_city,
       r.fare, r.ride_status, r.request_time
FROM rides r
INNER JOIN users     u_rider  ON r.rider_id            = u_rider.user_id
INNER JOIN users     u_driver ON r.driver_id           = u_driver.user_id
INNER JOIN vehicles  v        ON r.vehicle_id          = v.vehicle_id
INNER JOIN locations lp       ON r.pickup_location_id  = lp.location_id
INNER JOIN locations ld       ON r.dropoff_location_id = ld.location_id
ORDER BY r.request_time DESC;

-- LEFT JOIN: All riders including those who have never completed a ride
SELECT
    u.full_name        AS rider_name,
    u.email,
    COUNT(r.ride_id)   AS total_rides,
    SUM(r.fare)        AS total_spent
FROM users u
LEFT JOIN rides r ON u.user_id   = r.rider_id
               AND r.ride_status = 'completed'
WHERE u.role = 'rider'
GROUP BY u.user_id, u.full_name, u.email
ORDER BY total_rides DESC;

-- JOIN Payments + PromoCodes: discount usage per ride
SELECT
    r.ride_id,
    u.full_name          AS rider_name,
    p.amount             AS original_fare,
    pc.code              AS promo_used,
    p.promo_discount,
    p.final_amount,
    p.payment_method,
    p.payment_status
FROM payments p
JOIN      rides       r  ON p.ride_id  = r.ride_id
JOIN      users       u  ON p.rider_id = u.user_id
LEFT JOIN promo_codes pc ON p.promo_id = pc.promo_id
ORDER BY r.ride_id;

-- QUERY VIEWS (demonstrate they are queryable)
SELECT * FROM ActiveRidesView;
SELECT * FROM TopDriversView;


-- ROLE BASED ACCESS CONTROL (DCL) (Component 6)
CREATE USER IF NOT EXISTS 'rider_role'@'localhost'   IDENTIFIED BY 'Rider@2026';
CREATE USER IF NOT EXISTS 'driver_role'@'localhost'  IDENTIFIED BY 'Driver@2026';
CREATE USER IF NOT EXISTS 'support_role'@'localhost' IDENTIFIED BY 'Support@2026';
CREATE USER IF NOT EXISTS 'admin_role'@'localhost'   IDENTIFIED BY 'Admin@2026';

-- Admin: full access to everything
GRANT ALL PRIVILEGES ON RideFlow.* TO 'admin_role'@'localhost';

-- Rider: can book rides, make payments, leave ratings, view promos
GRANT SELECT, INSERT ON RideFlow.rides        TO 'rider_role'@'localhost';
GRANT SELECT, INSERT ON RideFlow.payments     TO 'rider_role'@'localhost';
GRANT SELECT, INSERT ON RideFlow.ratings      TO 'rider_role'@'localhost';
GRANT SELECT          ON RideFlow.promo_codes TO 'rider_role'@'localhost';

-- Driver: view rides only (cannot insert or delete)
GRANT SELECT ON RideFlow.rides    TO 'driver_role'@'localhost';
GRANT SELECT ON RideFlow.drivers  TO 'driver_role'@'localhost';
GRANT SELECT ON RideFlow.vehicles TO 'driver_role'@'localhost';

-- Support: read everything, but CANNOT delete any data
GRANT SELECT ON RideFlow.* TO 'support_role'@'localhost';
REVOKE DELETE ON RideFlow.rides    FROM 'support_role'@'localhost';
REVOKE DELETE ON RideFlow.payments FROM 'support_role'@'localhost';

FLUSH PRIVILEGES;

-- Added from myself--
CREATE TABLE IF NOT EXISTS fare_rules (
    rule_id          INT           AUTO_INCREMENT PRIMARY KEY,
    vehicle_type     ENUM('economy', 'premium', 'bike') NOT NULL,
    base_rate        DECIMAL(8,2)  NOT NULL,
    per_km_rate      DECIMAL(8,2)  NOT NULL,
    per_minute_rate  DECIMAL(8,2)  NOT NULL,
    surge_multiplier DECIMAL(4,2)  NOT NULL DEFAULT 1.00,
    surge_active     TINYINT(1)    NOT NULL DEFAULT 0,
    effective_from   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
 
    CHECK (base_rate       > 0),
    CHECK (per_km_rate     > 0),
    CHECK (per_minute_rate > 0),
    CHECK (surge_multiplier >= 1.00)
);
INSERT IGNORE INTO fare_rules (vehicle_type, base_rate, per_km_rate, per_minute_rate, surge_multiplier, surge_active)
VALUES
    ('economy', 50.00, 25.00, 3.00,  1.00, 0),
    ('premium', 100.00, 45.00, 5.00, 1.00, 0),
    ('bike',    30.00, 12.00,  1.50, 1.00, 0);
    
ALTER TABLE drivers ADD COLUMN is_flagged TINYINT(1) NOT NULL DEFAULT 0;

SELECT user_id, full_name, wallet_balance FROM users;