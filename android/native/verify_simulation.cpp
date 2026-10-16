#include "generated/vehicle_profiles.hpp"
#include <fstream>
#include <iostream>
#include <string>

static double read(std::ifstream &f) {
  double v;
  f.read(reinterpret_cast<char *>(&v), 8);
  if (!f)
    throw std::runtime_error("Truncated reference fixture");
  return v;
}
static std::vector<double> values(const dab::State &s) {
  std::vector<double> v = {
      s.position.x,        s.position.y,        s.position.z,
      s.quaternion.x,      s.quaternion.y,      s.quaternion.z,
      s.quaternion.w,      s.velocity.x,        s.velocity.y,
      s.velocity.z,        s.angularVelocity.x, s.angularVelocity.y,
      s.angularVelocity.z, double(s.gear),      s.rpm,
      s.throttle,          s.braking,           s.steer,
      s.heading,           s.distance,          s.tcsFactor};
  for (const auto &w : s.wheels)
    for (double x : {w.omega, w.spinAngle, w.compression, w.load, w.slipRatio,
                     w.slipAngle})
      v.push_back(x);
  return v;
}
int main(int argc, char **argv) {
  if (argc != 2) {
    std::cerr << "Usage: verify_simulation reference.bin\n";
    return 2;
  }
  std::ifstream f(argv[1], std::ios::binary);
  if (!f) {
    std::cerr << "Missing reference fixture\n";
    return 2;
  }
  int count = int(read(f));
  double worst = 0;
  size_t checked = 0;
  bool failed = false;
  std::array<double, 45> absolute{};
  for (int c = 0; c < count; c++) {
    int vehicle = int(read(f)), scenario = int(read(f));
    double heading = read(f);
    auto cfg = dab::vehicle_settings(vehicle);
    auto s = dab::create_state(heading, cfg);
    bool caseFailed = false;
    s.autoTransmission = read(f);
    s.abs = read(f);
    s.tcs = read(f);
    s.esc = read(f);
    int steps = int(read(f));
    double caseWorst = 0;
    for (int i = 0; i < steps; i++) {
      dab::Input in;
      in.throttle = read(f);
      in.brake = read(f);
      in.steer = read(f);
      in.handbrake = read(f);
      in.horn = read(f);
      in.clutch = read(f);
      in.shiftUp = read(f);
      in.shiftDown = read(f);
      dab::step(s, in, 1. / 120, cfg);
      if (i % 60 == 59) {
        auto actual = values(s);
        for (size_t k = 0; k < actual.size(); k++) {
          double expected = read(f), error = std::abs(actual[k] - expected),
                 scaled = error / std::max(1., std::abs(expected));
          absolute[k] = std::max(absolute[k], error);
          double tolerance = 1e-9 + std::abs(expected) * 1e-11;
          if (!std::isfinite(actual[k]) || error > tolerance) {
            if (!failed)
              std::cerr << "Mismatch: vehicle " << vehicle << ", scenario "
                        << scenario << ", step " << i << ", field " << k << ": "
                        << actual[k] << " vs " << expected << " (absolute "
                        << error << ")\n";
            failed = true;
            caseFailed = true;
          }
          caseWorst = std::max(caseWorst, scaled);
          checked++;
        }
      }
    }
    worst = std::max(worst, caseWorst);
    std::cout << (caseFailed ? "FAIL" : "PASS") << " vehicle=" << vehicle
              << " scenario=" << scenario
              << " max_normalized_error=" << caseWorst << "\n";
  }
  std::cout << "Verified " << checked << " scalar samples in " << count
            << " reference runs. Maximum normalized error: " << worst << "\n";
  for (size_t k = 0; k < absolute.size(); k++)
    std::cout << "field " << k << " max_absolute_error " << absolute[k] << "\n";
  return failed ? 1 : 0;
}
