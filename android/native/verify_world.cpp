#include "generated/vehicle_profiles.hpp"
#include "world.hpp"
#include <fstream>
#include <iostream>
static double read(std::ifstream &f) {
  double v = 0;
  f.read(reinterpret_cast<char *>(&v), 8);
  if (!f)
    throw std::runtime_error("Truncated world fixture");
  return v;
}
static dab::V vector(std::ifstream &f) {
  double x = read(f), y = read(f), z = read(f);
  return {x, y, z};
}
int main(int argc, char **argv) {
  if (argc != 3)
    return 2;
  std::ifstream file(argv[1], std::ios::binary);
  std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(file)), {});
  dab::World world;
  if (!world.load(bytes.data(), bytes.size())) {
    std::cerr << "Invalid collision asset\n";
    return 2;
  }
  std::ifstream f(argv[2], std::ios::binary);
  if (!f)
    return 2;
  double worstGround = 0, worstSweep = 0;
  int queries = int(read(f));
  for (int i = 0; i < queries; i++) {
    auto origin = vector(f), direction = vector(f);
    double max = read(f);
    bool valid = read(f);
    double distance = read(f);
    auto point = vector(f), normal = vector(f);
    double mu = read(f), rr = read(f);
    auto h = world.sample(origin, direction, max);
    if (h.valid != valid) {
      std::cerr << "Ground validity mismatch " << i << "\n";
      return 1;
    }
    if (!valid)
      continue;
    double error =
        std::max({std::abs(h.distance - distance), (h.point - point).length(),
                  (h.normal - normal).length(), std::abs(mu - h.mu),
                  std::abs(rr - h.rr)});
    worstGround = std::max(worstGround, error);
    if (error > 1e-5) {
      std::cerr << "Ground mismatch " << i << " error=" << error << "\n";
      return 1;
    }
  }
  int sweeps = int(read(f));
  for (int i = 0; i < sweeps; i++) {
    auto cfg = dab::vehicle_settings(int(read(f)));
    double heading = read(f);
    auto from = vector(f), to = vector(f);
    bool expectedHit = read(f);
    auto expectedPosition = vector(f);
    dab::Q expectedQ;
    expectedQ.x = read(f);
    expectedQ.y = read(f);
    expectedQ.z = read(f);
    expectedQ.w = read(f);
    auto expectedVelocity = vector(f);
    auto s = dab::create_state(heading, cfg, from);
    auto start = s.position;
    auto q = s.quaternion;
    s.position = to + dab::V{0, 0, s.comHeight};
    s.velocity = (s.position - start) * 120;
    bool hit = world.resolve(s, start, q, cfg);
    double error = std::max({(s.position - expectedPosition).length(),
                             (s.velocity - expectedVelocity).length(),
                             s.quaternion.angle(expectedQ)});
    worstSweep = std::max(worstSweep, error);
    if (hit != expectedHit || error > 1e-5) {
      std::cerr << "Sweep mismatch " << i << " error=" << error
                << " hit=" << hit << "/" << expectedHit << " from=" << from.x
                << "," << from.y << "," << from.z << " actual=" << s.position.x
                << "," << s.position.y << "," << s.position.z
                << " expected=" << expectedPosition.x << ","
                << expectedPosition.y << "," << expectedPosition.z
                << " velocity=" << s.velocity.x << "," << s.velocity.y << ","
                << s.velocity.z << " expected_velocity=" << expectedVelocity.x
                << "," << expectedVelocity.y << "," << expectedVelocity.z
                << "\n";
      return 1;
    }
  }
  std::cout << "WORLD_REFERENCE_PASS queries=" << queries
            << " swept_contacts=" << sweeps
            << " maximum_ground_error=" << worstGround
            << " maximum_sweep_error=" << worstSweep << "\n";
}
