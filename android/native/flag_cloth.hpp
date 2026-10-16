#pragma once
#include "simulation.hpp"

namespace dab {
// Position-based cloth from src/flagCloth.js. Separate from vehicle physics.
class FlagCloth {
  struct Link { int a, b; double distance, stiffness, wa, wb; bool stretch; };
  std::vector<Link> links;
  std::vector<int> indices;
  double time = 0, accumulator = 0;
  void link(int a, int b, double stiffness, bool stretch = false) {
    links.push_back({a,b,(rest[a]-rest[b]).length(),stiffness,a%33?1.:0.,b%33?1.:0.,stretch});
  }
  void calculate_normals() {
    std::fill(normals.begin(), normals.end(), V{});
    for (size_t i=0;i<indices.size();i+=3) {
      int a=indices[i], b=indices[i+1], c=indices[i+2];
      V n=(positions[c]-positions[b]).cross(positions[a]-positions[b]);
      normals[a]+=n;normals[b]+=n;normals[c]+=n;
    }
    for (auto &n:normals) n=n.normalized();
  }
  void step() {
    constexpr double dt=1./120.; time+=dt;
    const double speed=6.6+std::sin(time*.53)+.45*std::sin(time*1.17+.8);
    const double crosswind=1.1+.7*std::sin(time*.37+.4), damping=std::exp(-1.3*dt), scale=.5*1.225/.12;
    for (size_t i=0;i<positions.size();i++) {
      if(i%33==0)continue;
      const V p=positions[i], velocity=(p-previous[i])*(1/dt);
      const double eddy=.65*std::sin(time*3.1-rest[i].x*1.5+rest[i].z*.65)+.25*std::sin(time*5.3-rest[i].x*2.7-rest[i].z*1.1);
      const V wind=V{speed,crosswind+eddy,.35*std::sin(time*.71)}-velocity;
      const double normal_speed=clamp(wind.dot(normals[i]),-12,12), pressure=scale*normal_speed*std::abs(normal_speed);
      previous[i]=p;
      positions[i]=p+velocity*(dt*damping)+(normals[i]*pressure+wind*.45+V{0,0,-9.81})*(dt*dt);
    }
    for (int pass=0;pass<16;pass++) for(size_t j=0;j<links.size();j++) {
      const auto &l=links[pass%2?links.size()-1-j:j];const double weight=l.wa+l.wb;
      if(!weight)continue;
      const V delta=positions[l.b]-positions[l.a];const double length=delta.length();
      if((l.stretch&&length<=l.distance)||length<1e-8)continue;
      const double correction=(length-l.distance)/length*l.stiffness/weight;
      positions[l.a]+=delta*(correction*l.wa);positions[l.b]+=delta*(-correction*l.wb);
    }
    calculate_normals();
  }
public:
  std::vector<V> positions, previous, rest, normals;
  FlagCloth():positions(33*17),previous(33*17),rest(33*17),normals(33*17,V{0,-1,0}) {
    for(int row=0;row<=16;row++)for(int col=0;col<=32;col++){
      const int i=row*33+col;positions[i]=previous[i]=rest[i]=V{col/32.*7.2,0,-row/16.*3.6};
      if(col>0)link(row*33,i,1,true);
      // Rest positions must be initialized before creating cross-row links.
    }
    links.clear();
    for(int row=0;row<=16;row++)for(int col=0;col<=32;col++){
      const int i=row*33+col;
      if(col>0)link(row*33,i,1,true);
      if(col<32)link(i,i+1,1);
      if(row<16)link(i,i+33,1);
      if(col<32&&row<16){link(i,i+34,.8);link(i+1,i+33,.8);indices.insert(indices.end(),{i,i+33,i+1,i+33,i+34,i+1});}
      if(col+2<=32)link(i,i+2,.12);
      if(row+2<=16)link(i,i+66,.12);
    }
    for(int i=0;i<240;i++)step();
  }
  void advance(double dt) {
    if(!std::isfinite(dt)||dt<=0)return;
    accumulator+=std::min(dt,.1);
    while(accumulator+1e-10>=1./120.){step();accumulator-=1./120.;}
  }
};
}
