#pragma once

// Direct port of src/vehicleDynamics.js. Keep numerical order and tuning
// aligned with the web reference. No engine rigid body or vehicle solver runs
// alongside it.
#include "third_party/fdlibm/ieee754.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <limits>
#include <vector>

namespace dab {
namespace math = v8::base::ieee754;
constexpr double pi = 3.14159265358979323846;
inline double clamp(double v, double lo, double hi) {
  return std::max(lo, std::min(hi, v));
}
inline double sign(double v) { return (v > 0) - (v < 0); }
inline double lerp(double a, double b, double t) { return (1 - t) * a + t * b; }
inline double approach(double v, double t, double rate) {
  return v + clamp(t - v, -rate, rate);
}
inline double smooth(double a, double b, double v) {
  const double t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
// Match the browser's scaled two-component norm rather than the platform C
// library's independently rounded hypot. This matters near tire-slip branches.
inline double hypot2(double a, double b) {
  a = std::abs(a);
  b = std::abs(b);
  double max = std::max(a, b);
  if (max == 0)
    return 0;
  double x = a / max, y = b / max;
  return std::sqrt(x * x + y * y) * max;
}
inline double hypot3(double a, double b, double c) {
  a = std::abs(a);
  b = std::abs(b);
  c = std::abs(c);
  double max = std::max({a, b, c});
  if (max == 0)
    return 0;
  double x = a / max, y = b / max, z = c / max, A = x * x, B = y * y,
         compensation = (A + B) - A - B, C = z * z - compensation;
  return std::sqrt(A + B + C) * max;
}

struct V {
  double x = 0, y = 0, z = 0;
  V operator+(V b) const { return {x + b.x, y + b.y, z + b.z}; }
  V operator-(V b) const { return {x - b.x, y - b.y, z - b.z}; }
  V operator-() const { return {-x, -y, -z}; }
  V operator*(double s) const { return {x * s, y * s, z * s}; }
  V &operator+=(V b) {
    x += b.x;
    y += b.y;
    z += b.z;
    return *this;
  }
  V &operator*=(double s) {
    x *= s;
    y *= s;
    z *= s;
    return *this;
  }
  double dot(V b) const { return x * b.x + y * b.y + z * b.z; }
  V cross(V b) const {
    return {y * b.z - z * b.y, z * b.x - x * b.z, x * b.y - y * b.x};
  }
  double length2() const { return x * x + y * y + z * z; }
  double length() const { return std::sqrt(length2()); }
  V normalized() const {
    double l = length();
    return *this * (1 / (l > 0 ? l : 1));
  }
  double component(int i) const { return i == 0 ? x : i == 1 ? y : z; }
};
struct Q {
  double x = 0, y = 0, z = 0, w = 1;
  Q inverse() const { return {-x, -y, -z, w}; }
  Q operator*(Q b) const {
    return {x * b.w + w * b.x + y * b.z - z * b.y,
            y * b.w + w * b.y + z * b.x - x * b.z,
            z * b.w + w * b.z + x * b.y - y * b.x,
            w * b.w - x * b.x - y * b.y - z * b.z};
  }
  Q normalized() const {
    double l = 1 / std::sqrt(x * x + y * y + z * z + w * w);
    return {x * l, y * l, z * l, w * l};
  }
  V rotate(V v) const { // Three.js Vector3.applyQuaternion, in the same order.
    double tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z),
           tz = 2 * (x * v.y - y * v.x);
    return {v.x + w * tx + y * tz - z * ty, v.y + w * ty + z * tx - x * tz,
            v.z + w * tz + x * ty - y * tx};
  }
  static Q axis(V a, double angle) {
    double s = math::sin(angle / 2);
    return {a.x * s, a.y * s, a.z * s, math::cos(angle / 2)};
  }
  double angle(Q b) const {
    return 2 * math::acos(std::abs(
                   clamp(x * b.x + y * b.y + z * b.z + w * b.w, -1, 1)));
  }
  Q slerp(Q b, double t) const {
    double d = x * b.x + y * b.y + z * b.z + w * b.w;
    if (d < 0) {
      b = {-b.x, -b.y, -b.z, -b.w};
      d = -d;
    }
    if (d >= 1)
      return *this;
    const double sq = 1 - d * d;
    if (sq <= std::numeric_limits<double>::epsilon())
      return Q{lerp(x, b.x, t), lerp(y, b.y, t), lerp(z, b.z, t),
               lerp(w, b.w, t)}
          .normalized();
    const double s = std::sqrt(sq), a = math::atan2(s, d),
                 ra = math::sin((1 - t) * a) / s, rb = math::sin(t * a) / s;
    return {x * ra + b.x * rb, y * ra + b.y * rb, z * ra + b.z * rb,
            w * ra + b.w * rb};
  }
};
struct Tire {
  double B = 0, C = 0, E = 0;
};
inline double pacejka(Tire p, double slip) {
  double x = p.B * slip;
  return math::sin(p.C * math::atan(x - p.E * (x - math::atan(x))));
}
struct Settings {
  double massKg = 0, wheelbaseM = 0, trackM = 0, wheelRadius = 0,
         wheelInertia = 0;
  double suspRest = 0, suspTravel = 0, suspK = 0, suspCComp = 0, suspCReb = 0,
         bumpStopK = 0, hardpointZ = 0;
  double idleRpm = 0, redlineRpm = 0, engineBraking = 0, finalDrive = 0,
         drivelineEff = 0, shiftTime = 0;
  double brakeTorqueMax = 0, brakeBias = 0, handbrakeTorque = 0,
         latGripScale = 0, rearLatScale = 0, tireGrip = 0;
  double dragCoef = 0, liftCoef = 0, maxSteer = 0, steerHighSpeed = 0,
         launchTorqueMultiplier = 1;
  double width = 0, length = 0, height = 0, driveFront = 0, driveRear = 0;
  Tire pacLong, pacLat;
  std::vector<double> gears;
  std::vector<std::array<double, 2>> torqueCurve;
};
struct Input {
  double throttle = 0, brake = 0, steer = 0;
  bool handbrake = false, horn = false, clutch = false, shiftUp = false,
       shiftDown = false;
};
struct Wheel {
  V hp, contact, normal{0, 0, 1};
  bool front = false, grounded = false;
  double steer = 0, omega = 0, spinAngle = 0, compression = 0, load = 0,
         surfaceMu = 1, slipRatio = 0, slipAngle = 0, slideSpeed = 0,
         absFactor = 1;
};
struct State {
  V position, velocity, angularVelocity, force, torque;
  Q quaternion;
  double comHeight = 0, staticCompression = 0, shiftTimer = 0,
         shiftCooldown = 0;
  int gear = 1, shiftDirection = 0, groundedWheels = 0;
  bool autoTransmission = true, handbrake = false, horn = false, abs = true,
       tcs = true, esc = false;
  bool absActive = false, tcsActive = false, escActive = false;
  double rpm = 0, throttle = 0, braking = 0, engineLoad = 0,
         brakeForceInput = 0, steer = 0;
  double yawRate = 0, heading = 0, longitudinalSpeed = 0, lateralSpeed = 0,
         acceleration = 0, distance = 0, tcsFactor = 1;
  std::array<double, 4> escBrake{};
  std::array<Wheel, 4> wheels;
};
struct Hit {
  bool valid = false;
  double distance = 0;
  V point, normal{0, 0, 1};
  double mu = 1, rr = .013;
};
using Ground = std::function<Hit(V, V, double)>;
inline Hit flat_ground(V o, V d, double max) {
  if (d.z >= -.001)
    return {};
  double distance = -o.z / d.z;
  return distance >= 0 && distance <= max
             ? Hit{true, distance, o + d * distance, {0, 0, 1}, 1, .013}
             : Hit{};
}
inline State create_state(double heading, const Settings &s, V road = {}) {
  State v;
  v.staticCompression = s.massKg * 9.81 / (4 * s.suspK);
  v.comHeight = s.wheelRadius + s.suspRest - v.staticCompression - s.hardpointZ;
  v.position = road + V{0, 0, 1} * v.comHeight;
  v.quaternion = Q::axis({0, 0, 1}, heading);
  v.heading = heading;
  v.rpm = s.idleRpm;
  for (int i = 0; i < 4; i++) {
    auto &w = v.wheels[i];
    w.front = i < 2;
    w.hp = {(i % 2 ? 1. : -1.) * s.trackM / 2,
            (w.front ? 1. : -1.) * s.wheelbaseM / 2, s.hardpointZ};
    w.compression = v.staticCompression;
  }
  return v;
}
inline void shift(State &v, int gear, const Settings &s) {
  if (gear == v.gear || gear < 0 || gear >= int(s.gears.size()))
    return;
  bool launching = v.gear == 1 && gear == 2;
  v.shiftDirection = gear > v.gear ? 1 : -1;
  v.gear = gear;
  v.shiftTimer = launching ? .07 : s.shiftTime;
  v.shiftCooldown = launching ? .28 : .55;
}
inline double torque_at(const Settings &s, double rpm) {
  if (rpm <= s.torqueCurve.front()[0])
    return s.torqueCurve.front()[1];
  for (size_t i = 1; i < s.torqueCurve.size(); i++)
    if (rpm <= s.torqueCurve[i][0])
      return lerp(s.torqueCurve[i - 1][1], s.torqueCurve[i][1],
                  (rpm - s.torqueCurve[i - 1][0]) /
                      (s.torqueCurve[i][0] - s.torqueCurve[i - 1][0]));
  return s.torqueCurve.back()[1];
}
inline void add_force(State &v, V f, V p) {
  v.force += f;
  v.torque += (p - v.position).cross(f);
}
inline void static_wheel(Wheel &w, double longitudinal, double driveTorque,
                         double brake, State &v, const Settings &s, int i) {
  if (!w.grounded || w.load <= 0 || driveTorque != 0 || brake > 0 ||
      v.handbrake || v.escBrake[i] > 0 || std::abs(w.omega) >= 3)
    return;
  bool opposite = v.gear == 0 ? v.longitudinalSpeed > 0
                              : v.gear > 1 && v.longitudinalSpeed < 0;
  double limit = opposite ? 1.4 : .25;
  if (v.velocity.length2() < limit * limit)
    w.omega = std::abs(longitudinal) < .005 ? 0 : longitudinal / s.wheelRadius;
}
inline void integrate_wheel(Wheel &w, int i, double tireForce,
                            double longitudinal, double driveTorque,
                            double overrunTorque, double brake, State &v,
                            const Settings &s, double dt) {
  double share = (w.front ? s.driveFront : s.driveRear) * .5,
         torque = driveTorque * share;
  torque -= sign(w.omega) * std::min(overrunTorque * share,
                                     std::abs(w.omega) * s.wheelInertia / dt);
  if (w.grounded && std::abs(w.slipRatio) > .22 && torque != 0) {
    double limit =
        w.load * s.wheelRadius * s.tireGrip *
        (.88 + .22 * clamp(1 - 1.4 * (std::abs(w.slipRatio) - .22), 0, 1));
    torque = clamp(torque, -limit, limit);
  }
  w.omega += torque / s.wheelInertia * dt;
  if (w.grounded) {
    double go = longitudinal / s.wheelRadius,
           reaction = -tireForce * s.wheelRadius / s.wheelInertia * dt;
    w.omega = (w.omega - go) * (w.omega + reaction - go) <= 0
                  ? go
                  : w.omega + reaction;
  }
  double bt =
      brake * s.brakeTorqueMax * (w.front ? s.brakeBias : 1 - s.brakeBias);
  if (v.abs && bt > 0 && w.grounded && v.velocity.length2() > 4) {
    if (w.slipRatio < -.12) {
      w.absFactor = .38;
      v.absActive = true;
    } else
      w.absFactor = std::min(1., w.absFactor + 14 * dt);
    bt *= w.absFactor;
  } else
    w.absFactor = 1;
  bt += v.escBrake[i];
  if (v.handbrake && !w.front)
    bt += s.handbrakeTorque;
  double change = bt / s.wheelInertia * dt;
  w.omega = std::abs(w.omega) <= change ? 0 : w.omega - sign(w.omega) * change;
  static_wheel(w, longitudinal, driveTorque, brake, v, s, i);
  w.omega = clamp(w.omega, -320, 320);
  w.spinAngle += w.omega * dt;
}
inline void step(State &v, const Input &in, double dt, const Settings &s,
                 const Ground &ground = flat_ground) {
  Q &q = v.quaternion;
  V right = q.rotate({1, 0, 0}), forward = q.rotate({0, 1, 0}),
    up = q.rotate({0, 0, 1}), down = -up;
  double before = v.velocity.dot(forward), speed = v.velocity.length();
  double limit = lerp(s.maxSteer, s.steerHighSpeed, clamp(speed / 42, 0, 1));
  v.steer = approach(v.steer, clamp(in.steer, -1, 1) * limit, 4.2 * dt);
  double throttle = clamp(in.throttle, 0, 1),
         brakeTarget = clamp(in.brake, 0, 1);
  v.throttle =
      approach(v.throttle, throttle, (throttle > v.throttle ? 7 : 8) * dt);
  v.braking =
      approach(v.braking, brakeTarget, (brakeTarget > v.braking ? 9 : 11) * dt);
  v.handbrake = in.handbrake;
  v.horn = in.horn;
  double gas = v.gear == 0 && v.autoTransmission ? v.braking : v.throttle,
         brake = v.gear == 0 && v.autoTransmission ? v.throttle : v.braking;
  v.tcsActive = false;
  if (v.tcs && v.gear != 1) {
    double slip = 0;
    for (const auto &w : v.wheels)
      if (w.grounded && (w.front ? s.driveFront : s.driveRear))
        slip = std::max(slip, v.gear == 0 ? -w.slipRatio : w.slipRatio);
    double target = slip > .16 ? clamp(1 - 1.8 * (slip - .16), .65, 1) : 1;
    v.tcsFactor += (target - v.tcsFactor) *
                   clamp(dt * (target < v.tcsFactor ? 30 : 4.5), 0, 1);
    v.tcsActive = v.tcsFactor < .92 && gas > .1;
  } else
    v.tcsFactor = 1;
  double effective = gas * v.tcsFactor;
  v.engineLoad = effective;
  v.brakeForceInput = brake;
  v.escActive = false;
  v.escBrake.fill(0);
  if (v.esc && std::abs(before) > 5 && v.gear != 1) {
    double desired =
               clamp(math::tan(v.steer) * before / s.wheelbaseM, -1.3, 1.3),
           error = v.angularVelocity.dot(up) - desired;
    if (std::abs(error) > .28) {
      double c = clamp(1.5 * (std::abs(error) - .28), 0, 1);
      v.escActive = true;
      if (error > 0) {
        v.escBrake[0] = 1700 * c;
        v.escBrake[2] = 750 * c;
      } else {
        v.escBrake[1] = 1700 * c;
        v.escBrake[3] = 750 * c;
      }
    }
  }
  v.shiftTimer = std::max(0., v.shiftTimer - dt);
  v.shiftCooldown = std::max(0., v.shiftCooldown - dt);
  double wo = 0;
  int count = 0;
  for (const auto &w : v.wheels)
    if (w.front ? s.driveFront : s.driveRear) {
      wo += w.omega;
      count++;
    }
  wo = count ? wo / count : 0;
  double ratio = s.gears[v.gear] * s.finalDrive;
  bool coupled = v.gear != 1 && v.shiftTimer <= 0 && !in.clutch;
  double wheelRpm = std::max(s.idleRpm, 60 * std::abs(wo * ratio) / (2 * pi)),
         freeRpm = s.idleRpm + effective * (s.redlineRpm - s.idleRpm);
  double shiftRpm =
      v.shiftDirection > 0
          ? std::min(v.rpm, wheelRpm + 220)
          : std::max(v.rpm, std::min(s.redlineRpm, wheelRpm + 250));
  double target = coupled                          ? wheelRpm
                  : v.shiftTimer > 0 && v.gear > 1 ? shiftRpm
                                                   : freeRpm,
         response = coupled            ? 30
                    : v.shiftTimer > 0 ? (v.shiftDirection > 0 ? 10 : 12)
                                       : 4;
  v.rpm += (target - v.rpm) * clamp(response * dt, 0, 1);
  v.rpm = clamp(v.rpm, s.idleRpm * .8, s.redlineRpm + 300);
  if (v.autoTransmission && v.shiftCooldown <= 0) {
    if (v.gear >= 2 && v.rpm > s.redlineRpm - 350 &&
        v.gear < int(s.gears.size()) - 1)
      shift(v, v.gear + 1, s);
    else if (v.gear > 2 && v.rpm < s.idleRpm + 1000)
      shift(v, v.gear - 1, s);
    else if (v.gear >= 1 && brakeTarget > .4 && before < .6 && before > -3)
      shift(v, 0, s);
    else if (v.gear == 0 && throttle > .4 && before > -.6)
      shift(v, 2, s);
    else if (v.gear == 1 && throttle > .2)
      shift(v, 2, s);
  } else if (!v.autoTransmission) {
    if (in.shiftUp)
      shift(v, v.gear + 1, s);
    if (in.shiftDown)
      shift(v, v.gear - 1, s);
  }
  ratio = s.gears[v.gear] * s.finalDrive;
  coupled = v.gear != 1 && v.shiftTimer <= 0 && !in.clutch;
  double torque = 0, overrun = 0;
  if (coupled && v.rpm < s.redlineRpm + 150) {
    double assist = 1 + (s.launchTorqueMultiplier - 1) *
                            (1 - smooth(3, 12, std::abs(before)));
    torque = torque_at(s, v.rpm) * effective * assist;
    overrun = s.engineBraking * v.rpm / s.redlineRpm * (1 - effective);
  }
  double driveTorque = torque * ratio * s.drivelineEff,
         overrunTorque = overrun * std::abs(ratio) * s.drivelineEff;
  v.force = {0, 0, -9.81 * s.massKg};
  v.torque = {};
  v.force += v.velocity * (-s.dragCoef * speed);
  v.force.z += s.liftCoef * before * std::abs(before) * .5;
  v.groundedWheels = 0;
  v.absActive = false;
  double highest = -std::numeric_limits<double>::infinity(),
         maxRay = s.suspRest + s.wheelRadius + .15;
  for (int i = 0; i < 4; i++) {
    auto &w = v.wheels[i];
    w.steer = w.front ? v.steer : 0;
    V hp = q.rotate(w.hp) + v.position;
    Hit hit = ground(hp, down, maxRay);
    double previous = w.compression;
    if (!hit.valid) {
      w.grounded = false;
      w.compression = 0;
      w.load = 0;
      w.slideSpeed = 0;
      integrate_wheel(w, i, 0, 0, driveTorque, overrunTorque, brake, v, s, dt);
      continue;
    }
    w.grounded = true;
    w.surfaceMu = hit.mu;
    v.groundedWheels++;
    w.contact = hit.point;
    w.normal = hit.normal.normalized();
    if (w.normal.dot(up) < 0)
      w.normal = -w.normal;
    highest = std::max(highest, hit.point.z);
    w.compression =
        clamp(s.suspRest + s.wheelRadius - hit.distance, 0, s.suspRest);
    double rate = (w.compression - previous) / dt,
           spring = s.suspK * w.compression;
    if (w.compression > s.suspTravel)
      spring += s.bumpStopK * (w.compression - s.suspTravel);
    w.load =
        std::max(0., spring + (rate > 0 ? s.suspCComp : s.suspCReb) * rate);
    add_force(v, up * w.load, hp);
    V wf = q.rotate({-math::sin(w.steer), math::cos(w.steer), 0});
    wf = (wf + w.normal * (-wf.dot(w.normal))).normalized();
    V ws = wf.cross(w.normal).normalized();
    V cv = v.angularVelocity.cross(w.contact - v.position) + v.velocity;
    double longitudinal = cv.dot(wf), lateral = cv.dot(ws);
    static_wheel(w, longitudinal, driveTorque, brake, v, s, i);
    double surface = w.omega * s.wheelRadius;
    w.slipRatio =
        (surface - longitudinal) / std::max(std::abs(longitudinal), 2.2);
    w.slipAngle = math::atan2(lateral, std::abs(longitudinal) + .6);
    w.slideSpeed = hypot2(surface - longitudinal, lateral);
    double grip = hit.mu * w.load * s.tireGrip,
           fx = pacejka(s.pacLong, w.slipRatio) * grip,
           lat = s.latGripScale * (w.front ? 1 : s.rearLatScale);
    if (v.handbrake && !w.front)
      lat *= .55;
    double fy = -pacejka(s.pacLat, w.slipAngle) * grip * lat,
           combined = hypot2(fx, fy);
    if (combined > grip && combined > 0) {
      fx *= grip / combined;
      fy *= grip / combined;
    }
    double stick = smooth(1.4, .25, speed) * smooth(3, .5, std::abs(w.omega));
    if (stick > 0) {
      fx = lerp(fx, clamp(-longitudinal * w.load * 1.8, -grip, grip), stick);
      fy = lerp(fy, clamp(-lateral * w.load * 1.8, -grip, grip), stick);
    }
    double rolling = -hit.rr * w.load * clamp(longitudinal / .8, -1, 1);
    add_force(v, wf * (fx + rolling) + ws * fy, w.contact);
    integrate_wheel(w, i, fx, longitudinal, driveTorque, overrunTorque, brake,
                    v, s, dt);
  }
  v.velocity += v.force * (dt / s.massKg);
  double ix = s.massKg * (s.length * s.length + s.height * s.height) / 12,
         iy = s.massKg * (s.width * s.width + s.height * s.height) / 12,
         iz = s.massKg * (s.width * s.width + s.length * s.length) / 12;
  V local = q.inverse().rotate(v.torque);
  local = {local.x / ix, local.y / iy, local.z / iz};
  V acceleration = q.rotate(local);
  v.angularVelocity = (v.angularVelocity + acceleration * dt) * (1 - .12 * dt);
  v.angularVelocity.x = clamp(v.angularVelocity.x, -2.5, 2.5);
  v.angularVelocity.y = clamp(v.angularVelocity.y, -2.5, 2.5);
  v.angularVelocity.z = clamp(v.angularVelocity.z, -4, 4);
  v.position += v.velocity * dt;
  double rotation = v.angularVelocity.length() * dt;
  if (rotation > 1e-9)
    q = (Q::axis(v.angularVelocity.normalized(), rotation) * q).normalized();
  if (std::isfinite(highest) && v.position.z < highest + .25) {
    v.position.z = highest + .25;
    if (v.velocity.z < 0)
      v.velocity.z *= -.25;
  }
  forward = q.rotate({0, 1, 0});
  right = q.rotate({1, 0, 0});
  v.heading = math::atan2(-forward.x, forward.y);
  v.yawRate = v.angularVelocity.z;
  v.longitudinalSpeed = v.velocity.dot(forward);
  v.lateralSpeed = v.velocity.dot(right);
  v.acceleration = (v.longitudinalSpeed - before) / dt;
  v.distance += hypot2(v.velocity.x, v.velocity.y) * dt;
}
} // namespace dab
