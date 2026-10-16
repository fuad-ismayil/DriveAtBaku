#pragma once
#include "simulation.hpp"
#include <cstdint>
#include <cstring>
#include <numeric>

namespace dab {
struct Box {
  V lo{INFINITY, INFINITY, INFINITY}, hi{-INFINITY, -INFINITY, -INFINITY};
  void add(V p) {
    lo = {std::min(lo.x, p.x), std::min(lo.y, p.y), std::min(lo.z, p.z)};
    hi = {std::max(hi.x, p.x), std::max(hi.y, p.y), std::max(hi.z, p.z)};
  }
  void add(Box b) {
    add(b.lo);
    add(b.hi);
  }
  bool intersects(Box b) const {
    return lo.x <= b.hi.x && hi.x >= b.lo.x && lo.y <= b.hi.y &&
           hi.y >= b.lo.y && lo.z <= b.hi.z && hi.z >= b.lo.z;
  }
};
struct Triangle {
  V a, b, c;
  double mu = 1, rr = .013;
  int layer = 0;
  Box bounds() const {
    Box box;
    box.add(a);
    box.add(b);
    box.add(c);
    return box;
  }
};
struct Tree {
  struct Node {
    Box box;
    int start = 0, count = 0, left = -1, right = -1;
  };
  std::vector<Triangle> triangles;
  std::vector<int> order;
  std::vector<Node> nodes;
  int build_node(int start, int count) {
    const int id = int(nodes.size());
    nodes.emplace_back();
    Box box;
    for (int i = start; i < start + count; i++)
      box.add(triangles[order[i]].bounds());
    nodes[id].box = box;
    nodes[id].start = start;
    nodes[id].count = count;
    if (count <= 16)
      return id;
    V extent = box.hi - box.lo;
    int axis = extent.x > extent.y ? (extent.x > extent.z ? 0 : 2)
                                   : (extent.y > extent.z ? 1 : 2);
    int mid = start + count / 2;
    std::nth_element(order.begin() + start, order.begin() + mid,
                     order.begin() + start + count, [&](int a, int b) {
                       auto ta = triangles[a], tb = triangles[b];
                       double ca = (ta.a + ta.b + ta.c).component(axis),
                              cb = (tb.a + tb.b + tb.c).component(axis);
                       return ca == cb ? a < b : ca < cb;
                     });
    int left = build_node(start, mid - start),
        right = build_node(mid, start + count - mid);
    nodes[id].left = left;
    nodes[id].right = right;
    nodes[id].count = 0;
    return id;
  }
  void build() {
    order.resize(triangles.size());
    std::iota(order.begin(), order.end(), 0);
    nodes.clear();
    nodes.reserve(triangles.size() / 4 + 1);
    if (!order.empty())
      build_node(0, int(order.size()));
  }
  template <class F> void query(Box box, F visit, int id = 0) const {
    if (nodes.empty())
      return;
    const auto &n = nodes[id];
    if (!n.box.intersects(box))
      return;
    if (n.count) {
      for (int i = n.start; i < n.start + n.count; i++) {
        int ix = order[i];
        if (triangles[ix].bounds().intersects(box))
          visit(ix, triangles[ix]);
      }
    } else {
      query(box, visit, n.left);
      query(box, visit, n.right);
    }
  }
};
struct Trunk {
  double x = 0, y = 0, bottom = 0, top = 0, radius = 0;
};
struct Sweep {
  bool valid = false;
  double time = INFINITY, depth = 0;
  V normal;
};
struct World {
  Tree ground, walls;
  std::vector<Trunk> trunks;
  bool load(const uint8_t *data, size_t length) {
    if (length < 20 || std::memcmp(data, "DABW", 4) != 0)
      return false;
    size_t pos = 4;
    auto u32 = [&]() {
      uint32_t v;
      std::memcpy(&v, data + pos, 4);
      pos += 4;
      return v;
    };
    if (u32() != 1)
      return false;
    uint32_t ng = u32(), nw = u32(), nt = u32();
    if (ng > 3000000 || nw > 3000000 || nt > 100000 ||
        length != 20 + size_t(ng) * 96 + size_t(nw) * 72 + size_t(nt) * 40)
      return false;
    auto number = [&]() {
      double v;
      std::memcpy(&v, data + pos, 8);
      pos += 8;
      return v;
    };
    auto vector = [&]() {
      double x = number(), y = number(), z = number();
      return V{x, y, z};
    };
    std::vector<Triangle> g, w;
    std::vector<Trunk> tr;
    g.reserve(ng);
    w.reserve(nw);
    tr.reserve(nt);
    for (uint32_t i = 0; i < ng; i++) {
      Triangle t;
      t.a = vector();
      t.b = vector();
      t.c = vector();
      t.mu = number();
      t.rr = number();
      t.layer = int(number());
      if (t.layer < 0 || t.layer > 4)
        return false;
      g.push_back(t);
    }
    for (uint32_t i = 0; i < nw; i++) {
      Triangle t;
      t.a = vector();
      t.b = vector();
      t.c = vector();
      w.push_back(t);
    }
    for (uint32_t i = 0; i < nt; i++) {
      Trunk t;
      t.x = number();
      t.y = number();
      t.bottom = number();
      t.top = number();
      t.radius = number();
      tr.push_back(t);
    }
    ground.triangles = std::move(g);
    walls.triangles = std::move(w);
    trunks = std::move(tr);
    ground.build();
    walls.build();
    return true;
  }
  Hit sample(V origin, V direction, double maxDistance) const {
    Box bounds;
    bounds.add(origin);
    bounds.add(origin + direction * maxDistance);
    bounds.lo += V{-1e-6, -1e-6, -1e-6};
    bounds.hi += V{1e-6, 1e-6, 1e-6};
    std::array<Hit, 5> layers{};
    std::array<int, 5> indices;
    indices.fill(INT32_MAX);
    ground.query(bounds, [&](int ix, const Triangle &t) {
      V e1 = t.b - t.a, e2 = t.c - t.a, p = direction.cross(e2);
      double det = e1.dot(p);
      if (std::abs(det) < 1e-12)
        return;
      double inv = 1 / det;
      V tv = origin - t.a;
      double u = tv.dot(p) * inv;
      if (u < 0 || u > 1)
        return;
      V q = tv.cross(e1);
      double v = direction.dot(q) * inv;
      if (v < 0 || u + v > 1)
        return;
      double d = e2.dot(q) * inv;
      if (d < 0 || d > maxDistance)
        return;
      auto &hit = layers[t.layer];
      if (hit.valid &&
          (d > hit.distance || (d == hit.distance && ix >= indices[t.layer])))
        return;
      V n = e1.cross(e2).normalized();
      if (n.z < 0)
        n = -n;
      hit = {true, d, origin + direction * d, n, t.mu, t.rr};
      indices[t.layer] = ix;
    });
    Hit best;
    for (int i = 0; i < 4; i++)
      if (layers[i].valid &&
          (!best.valid || layers[i].distance < best.distance - 1e-4))
        best = layers[i];
    auto inlay = layers[4];
    return inlay.valid && (!best.valid || best.distance - inlay.distance > .04)
               ? inlay
               : best;
  }
  static Sweep triangle_sweep(const Triangle &t, V center, V half,
                              const std::array<V, 3> &axes, V travel,
                              double margin) {
    V normal = (t.c - t.b).cross(t.a - t.b).normalized();
    if (std::abs(normal.z) >= .65 || normal.length2() < .5)
      return {};
    std::array<V, 3> edges = {t.b - t.a, t.c - t.b, t.a - t.c};
    std::array<V, 13> test;
    for (int i = 0; i < 3; i++)
      test[i] = axes[i];
    test[3] = normal;
    for (int i = 0; i < 3; i++)
      for (int j = 0; j < 3; j++)
        test[4 + i * 3 + j] = axes[i].cross(edges[j]);
    double enter = -INFINITY, exit = INFINITY;
    for (V axis : test) {
      if (axis.length2() < 1e-12)
        continue;
      axis = axis.normalized();
      double a = t.a.dot(axis), b = t.b.dot(axis), c = t.c.dot(axis),
             low = std::min({a, b, c}), high = std::max({a, b, c});
      double radius = std::abs(axis.dot(axes[0])) * half.x +
                      std::abs(axis.dot(axes[1])) * half.y +
                      std::abs(axis.dot(axes[2])) * half.z,
             projection = center.dot(axis), speed = travel.dot(axis);
      if (std::abs(speed) < 1e-10) {
        if (projection + radius < low || projection - radius > high)
          return {};
      } else {
        double t1 = (low - projection - radius) / speed,
               t2 = (high - projection + radius) / speed;
        enter = std::max(enter, std::min(t1, t2));
        exit = std::min(exit, std::max(t1, t2));
        if (enter > exit)
          return {};
      }
    }
    if (exit < 0 || enter > 1)
      return {};
    double sd = (center - t.a).dot(normal);
    V response = normal;
    if (sd < 0 || (std::abs(sd) < 1e-8 && response.dot(travel) > 0))
      response = -response;
    double radius = std::abs(normal.dot(axes[0])) * half.x +
                    std::abs(normal.dot(axes[1])) * half.y +
                    std::abs(normal.dot(axes[2])) * half.z,
           planar = hypot2(response.x, response.y);
    response.z = 0;
    response *= 1 / planar;
    double depth = std::max(0., radius - std::abs(sd)) / planar,
           time = std::max(0., enter);
    if (time == 0 && response.dot(travel) >= -1e-9 && depth <= .05 &&
        margin == 0)
      return {};
    return {true, time, time == 0 ? depth : 0, response};
  }
  Sweep sweep(V position, Q orientation, V travel, const Settings &s,
              double comHeight, double margin = 0) const {
    V half{s.width / 2 + .025 + margin, s.length / 2 + .025 + margin,
           (s.height - .16) / 2 + margin};
    V center =
        position + orientation.rotate({0, 0, (s.height + .16) / 2 - comHeight});
    std::array<V, 3> axes = {orientation.rotate({1, 0, 0}),
                             orientation.rotate({0, 1, 0}),
                             orientation.rotate({0, 0, 1})};
    V wh;
    wh.x = std::abs(axes[0].x) * half.x + std::abs(axes[1].x) * half.y +
           std::abs(axes[2].x) * half.z;
    wh.y = std::abs(axes[0].y) * half.x + std::abs(axes[1].y) * half.y +
           std::abs(axes[2].y) * half.z;
    wh.z = std::abs(axes[0].z) * half.x + std::abs(axes[1].z) * half.y +
           std::abs(axes[2].z) * half.z;
    Box query;
    query.add(center - wh);
    query.add(center + wh);
    query.add(center - wh + travel);
    query.add(center + wh + travel);
    Sweep best;
    auto accept = [&](Sweep h) {
      if (h.valid &&
          (h.time < best.time || (h.time == best.time && h.depth > best.depth)))
        best = h;
    };
    std::vector<int> candidates;
    walls.query(query,
                [&](int ix, const Triangle &) { candidates.push_back(ix); });
    std::sort(candidates.begin(), candidates.end());
    for (int ix : candidates)
      accept(triangle_sweep(walls.triangles[ix], center, half, axes, travel,
                            margin));
    // Port of CylinderCollision's convex projected box sweep. Cylinders have
    // finite heights; tree canopies remain entirely non-colliding.
    std::vector<V> points;
    for (int i = 0; i < 8; i++) {
      V p = center;
      for (int j = 0; j < 3; j++)
        p += axes[j] * (half.component(j) * (i & (1 << j) ? 1 : -1));
      points.push_back({p.x, p.y, 0});
    }
    std::sort(points.begin(), points.end(),
              [](V a, V b) { return a.x == b.x ? a.y < b.y : a.x < b.x; });
    std::vector<V> hull;
    auto cross = [](V a, V b, V c) { return (b - a).cross(c - a).z; };
    for (V p : points) {
      while (hull.size() >= 2 &&
             cross(hull[hull.size() - 2], hull.back(), p) <= 1e-10)
        hull.pop_back();
      hull.push_back(p);
    }
    size_t lower = hull.size();
    for (int i = int(points.size()) - 2; i >= 0; i--) {
      V p = points[i];
      while (hull.size() > lower &&
             cross(hull[hull.size() - 2], hull.back(), p) <= 1e-10)
        hull.pop_back();
      hull.push_back(p);
    }
    hull.pop_back();
    for (const auto &t : trunks) {
      Box box;
      box.add(V{t.x - t.radius, t.y - t.radius, t.bottom});
      box.add(V{t.x + t.radius, t.y + t.radius, t.top});
      if (!box.intersects(query))
        continue;
      double first = 0, last = 1, low = center.z - wh.z, high = center.z + wh.z;
      if (std::abs(travel.z) < 1e-10) {
        if (high < t.bottom || low > t.top)
          continue;
      } else {
        double a = (t.bottom - high) / travel.z, b = (t.top - low) / travel.z;
        first = std::max(0., std::min(a, b));
        last = std::min(1., std::max(a, b));
        if (first > last)
          continue;
      }
      double vx = -travel.x, vy = -travel.y, px = t.x + vx * first,
             py = t.y + vy * first;
      bool inside = true;
      double ed = INFINITY, inx = 0, iny = 0, closest = INFINITY, cx = 0,
             cy = 0;
      for (size_t i = 0; i < hull.size(); i++) {
        V a = hull[i], b = hull[(i + 1) % hull.size()];
        double ex = b.x - a.x, ey = b.y - a.y, len = hypot2(ex, ey);
        if (len < 1e-9)
          continue;
        double nx = ey / len, ny = -ex / len,
               sd = (px - a.x) * nx + (py - a.y) * ny;
        if (sd > 0)
          inside = false;
        if (t.radius - sd < ed) {
          ed = t.radius - sd;
          inx = -nx;
          iny = -ny;
        }
        double p = clamp(((px - a.x) * ex + (py - a.y) * ey) / (len * len), 0,
                         1),
               qx = a.x + ex * p, qy = a.y + ey * p,
               d = hypot2(px - qx, py - qy);
        if (d < closest) {
          closest = d;
          cx = qx;
          cy = qy;
        }
      }
      double depth = inside ? ed : t.radius - closest;
      if (inside || depth > 0) {
        V n = inside ? V{inx, iny, 0}
                     : V{(cx - px) / std::max(closest, 1e-12),
                         (cy - py) / std::max(closest, 1e-12), 0};
        if (!(first == 0 && n.dot(travel) >= -1e-9 && depth <= .05 &&
              margin == 0))
          accept({true, first, depth, n});
        continue;
      }
      for (size_t i = 0; i < hull.size(); i++) {
        V a = hull[i], b = hull[(i + 1) % hull.size()];
        double ex = b.x - a.x, ey = b.y - a.y, len = hypot2(ex, ey);
        if (len < 1e-9)
          continue;
        double nx = ey / len, ny = -ex / len, rate = vx * nx + vy * ny;
        if (rate < -1e-10) {
          double time = (t.radius - (t.x - a.x) * nx - (t.y - a.y) * ny) / rate,
                 along = ((t.x + vx * time - a.x) * ex +
                          (t.y + vy * time - a.y) * ey) /
                         len;
          if (time >= first - 1e-10 && time <= last && along >= 0 &&
              along <= len)
            accept({true, std::max(first, time), 0, {-nx, -ny, 0}});
        }
        double dx = t.x - a.x, dy = t.y - a.y, A = vx * vx + vy * vy,
               B = 2 * (dx * vx + dy * vy),
               C = dx * dx + dy * dy - t.radius * t.radius,
               disc = B * B - 4 * A * C;
        if (A > 1e-12 && disc >= 0) {
          double time = (-B - std::sqrt(disc)) / (2 * A);
          if (time >= first - 1e-10 && time <= last)
            accept({true, std::max(first, time), 0,
                    V{a.x - t.x - vx * time, a.y - t.y - vy * time, 0}
                        .normalized()});
        }
      }
    }
    return best;
  }
  bool resolve(State &v, V previous, Q previousQ, const Settings &s) const {
    V start = previous, total = v.position - start;
    Q rotation = v.quaternion, orientation = previousQ;
    double radius = hypot3(s.width, s.length, s.height) / 2;
    int steps =
        std::max(1, int(std::ceil(orientation.angle(rotation) * radius / .04)));
    V stepTravel = total * (1. / steps);
    bool collided = false, blocked = false;
    for (int n = 0; n < steps; n++) {
      Q next = previousQ.slerp(rotation, double(n + 1) / steps);
      double margin = blocked ? 0 : orientation.angle(next) * radius;
      V remaining = stepTravel;
      for (int i = 0; i < 4; i++) {
        auto hit = sweep(start, orientation, remaining, s, v.comHeight,
                         i == 0 ? margin : 0);
        if (!hit.valid) {
          start += remaining;
          break;
        }
        collided = true;
        blocked = true;
        double advance =
            std::max(0., hit.time - .002 / std::max(remaining.length(), .002));
        start += remaining * advance;
        if (hit.depth > margin + .025)
          start += hit.normal * (hit.depth + .002);
        remaining *= 1 - advance;
        double inward = remaining.dot(hit.normal);
        if (inward < 0)
          remaining += hit.normal * (-inward);
        double velocity = v.velocity.dot(hit.normal);
        if (velocity < 0)
          v.velocity +=
              hit.normal * (-velocity * (std::abs(velocity) > 2 ? 1.08 : 1));
        v.angularVelocity *= .3;
        if (remaining.length2() < 1e-10 && hit.depth <= margin + .025)
          break;
      }
      if (!blocked)
        orientation = next;
    }
    v.position = start;
    v.quaternion = orientation;
    if (collided) {
      V forward = orientation.rotate({0, 1, 0}),
        right = orientation.rotate({1, 0, 0});
      v.heading = math::atan2(-forward.x, forward.y);
      v.yawRate = v.angularVelocity.z;
      v.longitudinalSpeed = v.velocity.dot(forward);
      v.lateralSpeed = v.velocity.dot(right);
    }
    return collided;
  }
};
} // namespace dab
