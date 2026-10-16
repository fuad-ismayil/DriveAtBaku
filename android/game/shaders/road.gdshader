shader_type spatial;
render_mode cull_disabled;
uniform vec4 tint : source_color = vec4(1.0);
uniform sampler2D color_texture : source_color,filter_linear_mipmap_anisotropic;
uniform bool has_texture = false;
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform float roughness_value = .75;
uniform float metallic_value = 0.0;
uniform float wetness = 0.0;
uniform float rainfall = 0.0;
uniform float snow = 0.0;
varying vec3 world_position;
varying vec3 world_normal;
float weatherNoise(vec2 p){
 vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1,0),vec2(127.1,311.7)),dot(i+vec2(0,1),vec2(127.1,311.7)),dot(i+1.0,vec2(127.1,311.7))))*43758.5453);
 return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
}
float depression(vec2 p){return weatherNoise(p*.46)*.64+weatherNoise(p*1.35+vec2(13.7,4.1))*.26+weatherNoise(p*3.8)*.10;}
vec2 ripple(vec2 p){
 vec2 cell=floor(p*1.4),offset=fract(p*1.4)-.5;
 float phase=fract(TIME*1.7+weatherNoise(cell+17.0)*7.0),radius=length(offset);
 float ring=exp(-pow((radius-phase*.48)*36.0,2.0))*(1.0-phase);
 return offset/max(radius,.01)*ring*.028;
}
void vertex(){world_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;world_normal=normalize(MODEL_NORMAL_MATRIX*NORMAL);}
void fragment(){
 vec3 color=tint.rgb;
 if(has_texture){color*=texture(color_texture,UV*uv_scale+uv_offset).rgb;}
 vec2 p=vec2(world_position.x,-world_position.z);
 float top=smoothstep(.45,.92,world_normal.y);
 float wet=wetness*mix(.12,1.0,top);
 float pool=0.0;
 if(wetness>0.0&&snow<.001){
  float drain=1.0-smoothstep(.035,.14,length(cross(normalize(world_normal),vec3(0,1,0))));
  float d=depression(p),width=max(fwidth(d),.018);
  float basin=1.0-smoothstep(.25-width,.36+width,d);
  float pocket=1.0-smoothstep(.18,.28,weatherNoise(p*3.8+7.1));
  pool=max(basin,pocket*.16)*drain*top*wetness;
 }
 if(wetness<1.0){
  float luma=dot(color,vec3(.2126,.7152,.0722));
  float aggregate=1.0-smoothstep(.18,.42,luma);
  vec3 charcoal=mix(vec3(luma),color,.88)*vec3(1.02,1.0,.97)*mix(.83,.91,weatherNoise(p*.075));
  color=mix(color,charcoal,aggregate*(1.0-wetness));
 }
 vec2 waves=vec2(0.0);
 if(rainfall>0.0&&pool>.05){waves=ripple(p)*min(rainfall,1.0);}
 vec3 water_normal=normalize(mat3(VIEW_MATRIX)*vec3(waves.x,1.0,-waves.y));
 NORMAL=normalize(mix(NORMAL,water_normal,pool*.94));
 color*=mix(1.0,mix(.60,.48,pool),wet);
 float settled=snow*top*mix(.78,1.0,weatherNoise(p*.9));
 ALBEDO=mix(color,vec3(.84,.88,.92),settled);
 ROUGHNESS=mix(mix(roughness_value,mix(.30,.12,pool),wet),.96,settled);
 METALLIC=metallic_value*(1.0-settled);
 SPECULAR=mix(.14,.255,wetness);
}
