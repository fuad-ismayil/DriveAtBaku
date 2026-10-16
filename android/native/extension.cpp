#include "generated/vehicle_profiles.hpp"
#include "world.hpp"
#include "flag_cloth.hpp"
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/godot.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/dictionary.hpp>

using namespace godot;
class NativeFlag : public RefCounted {
  GDCLASS(NativeFlag, RefCounted)
  dab::FlagCloth cloth;
protected:
  static void _bind_methods() { ClassDB::bind_method(D_METHOD("advance", "dt"), &NativeFlag::advance); }
public:
  Dictionary advance(double dt) {
    cloth.advance(dt);
    PackedVector3Array positions, normals;
    for (size_t i=0;i<cloth.positions.size();i++) {
      auto p=cloth.positions[i], n=cloth.normals[i];
      positions.push_back(Vector3(p.x,p.z,-p.y));normals.push_back(Vector3(n.x,n.z,-n.y));
    }
    Dictionary result;result["positions"]=positions;result["normals"]=normals;return result;
  }
};
class NativeDriving : public RefCounted {
  GDCLASS(NativeDriving, RefCounted)
  dab::State state;
  dab::Settings settings = dab::vehicle_settings(0);
  dab::World world;
  bool world_ready = false;
  static Vector3 vector(dab::V v) { return Vector3(v.x, v.z, -v.y); }
  static Array precise(dab::V v) {
    Array a;
    a.push_back(v.x);
    a.push_back(v.y);
    a.push_back(v.z);
    return a;
  }

protected:
  static void _bind_methods() {
    ClassDB::bind_method(
        D_METHOD("reset", "vehicle", "road_position", "heading", "automatic"),
        &NativeDriving::reset);
    ClassDB::bind_method(D_METHOD("load_world", "path"),
                         &NativeDriving::load_world);
    ClassDB::bind_method(D_METHOD("advance", "input", "dt"),
                         &NativeDriving::advance);
    ClassDB::bind_method(D_METHOD("snapshot"), &NativeDriving::snapshot);
    ClassDB::bind_method(D_METHOD("set_aids", "abs", "tcs", "esc"),
                         &NativeDriving::set_aids);
    ClassDB::bind_method(D_METHOD("set_automatic", "enabled"),
                         &NativeDriving::set_automatic);
    ClassDB::bind_method(D_METHOD("road_height", "position"),
                         &NativeDriving::road_height);
  }

public:
  NativeDriving() { state = dab::create_state(0, settings); }
  void reset(int vehicle, Vector3 p, double heading, bool automatic) {
    settings = dab::vehicle_settings(vehicle);
    state = dab::create_state(heading, settings, {p.x, -p.z, p.y});
    state.autoTransmission = automatic;
  }
  bool load_world(String path) {
    auto bytes = FileAccess::get_file_as_bytes(path);
    world_ready = world.load(bytes.ptr(), bytes.size());
    return world_ready;
  }
  void set_aids(bool a, bool t, bool e) {
    state.abs = a;
    state.tcs = t;
    state.esc = e;
  }
  void set_automatic(bool automatic) { state.autoTransmission = automatic; }
  double road_height(Vector3 p) {
    auto h = world.sample({p.x, -p.z, p.y + 6}, {0, 0, -1}, 30);
    return h.valid ? h.point.z : p.y;
  }
  void advance(Dictionary input, double dt) {
    if (!std::isfinite(dt) || dt <= 0 || dt > .05)
      return;
    dab::Input in;
    in.throttle = input.get("throttle", 0.);
    in.brake = input.get("brake", 0.);
    in.steer = input.get("steer", 0.);
    in.handbrake = input.get("handbrake", false);
    in.horn = input.get("horn", false);
    in.clutch = input.get("clutch", false);
    in.shiftUp = input.get("shift_up", false);
    in.shiftDown = input.get("shift_down", false);
    auto previous = state.position;
    auto q = state.quaternion;
    if (world_ready) {
      dab::step(state, in, dt, settings, [this](dab::V a, dab::V b, double c) {
        return world.sample(a, b, c);
      });
      world.resolve(state, previous, q, settings);
    } else
      dab::step(state, in, dt, settings);
  }
  Dictionary snapshot() const {
    Dictionary d;
    auto q = state.quaternion;
    d["position"] = vector(state.position);
    d["rotation"] = Quaternion(q.x, q.z, -q.y, q.w);
    d["velocity"] = vector(state.velocity);
    d["angular_velocity"] = vector(state.angularVelocity);
    d["wire_position"] = precise(state.position);
    d["wire_velocity"] = precise(state.velocity);
    d["wire_angular_velocity"] = precise(state.angularVelocity);
    Array wire_q;
    for (double a : {q.x, q.y, q.z, q.w})
      wire_q.push_back(a);
    d["wire_rotation"] = wire_q;
    d["com_height"] = state.comHeight;
    d["static_compression"] = state.staticCompression;
    d["gear"] = state.gear;
    d["automatic"] = state.autoTransmission;
    d["rpm"] = state.rpm;
    d["throttle"] = state.throttle;
    d["engine_load"] = state.engineLoad;
    d["shift_timer"] = state.shiftTimer;
    d["brake"] = state.braking;
    d["brake_force"] = state.brakeForceInput;
    d["steer"] = state.steer;
    d["speed"] = state.longitudinalSpeed;
    d["heading"] = state.heading;
    d["acceleration"] = state.acceleration;
    d["grounded"] = state.groundedWheels;
    d["abs_active"] = state.absActive;
    d["tcs_active"] = state.tcsActive;
    d["esc_active"] = state.escActive;
    d["handbrake"] = state.handbrake;
    d["horn"] = state.horn;
    Array wheels;
    for (auto &w : state.wheels) {
      Dictionary wd;
      wd["steer"] = w.steer;
      wd["spin"] = w.spinAngle;
      wd["compression"] = w.compression;
      wd["slip"] = w.slideSpeed;
      wd["grounded"] = w.grounded;
      wd["contact"] = precise(w.contact);
      wd["normal"] = vector(w.normal);
      wd["load"] = w.load;
      wd["surface_mu"] = w.surfaceMu;
      wheels.push_back(wd);
    }
    d["wheels"] = wheels;
    return d;
  }
};
static void initialize(ModuleInitializationLevel level) {
  if (level == MODULE_INITIALIZATION_LEVEL_SCENE) {
    ClassDB::register_class<NativeDriving>();
    ClassDB::register_class<NativeFlag>();
  }
}
static void terminate(ModuleInitializationLevel) {}
extern "C" GDExtensionBool GDE_EXPORT driveatbaku_library_init(
    GDExtensionInterfaceGetProcAddress get_proc,
    GDExtensionClassLibraryPtr library, GDExtensionInitialization *init) {
  GDExtensionBinding::InitObject object(get_proc, library, init);
  object.register_initializer(initialize);
  object.register_terminator(terminate);
  object.set_minimum_library_initialization_level(
      MODULE_INITIALIZATION_LEVEL_SCENE);
  return object.init();
}
