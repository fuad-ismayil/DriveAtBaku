shader_type spatial;
render_mode cull_disabled;
uniform vec4 tint : source_color = vec4(1.0);
uniform sampler2D color_texture : source_color,filter_linear_mipmap_anisotropic;
uniform sampler2D house_surface : filter_linear_mipmap;
uniform bool has_texture = false;
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform float roughness_value = .88;
uniform float metallic_value = 0.0;
uniform float night = 0.0;
varying vec3 world_position;
varying vec3 world_normal;
float beam(float p,float spacing,float width){float d=abs(mod(p+spacing*.5,spacing)-spacing*.5);return exp(-d*d/(width*width));}
void vertex(){world_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;world_normal=normalize(MODEL_NORMAL_MATRIX*NORMAL);}
void fragment(){
 vec2 uv=UV*uv_scale+uv_offset;
 vec3 color=tint.rgb;if(has_texture){color*=texture(color_texture,uv).rgb;}
 vec2 data=texture(house_surface,uv).rg;
 color*=vec3(1.09,1.055,.99);
 color=mix(color,mix(color,vec3(.048,.062,.067),.64),data.g);
 ALBEDO=color;ROUGHNESS=mix(.88,.29,data.g);METALLIC=0.0;
 // Same facade coordinates, beam spacing and architectural wash as the web.
 vec2 delta=vec2(world_position.x,-world_position.z)-vec2(680.13,630.01);
 vec2 across=vec2(.924988,.379995),back=vec2(-across.y,across.x);
 vec3 hp=vec3(dot(delta,across),dot(delta,back),world_position.y);
 vec3 wn=vec3(world_normal.x,-world_normal.z,world_normal.y);
 vec2 hn=vec2(dot(wn.xy,across),dot(wn.xy,back));
 float tower=smoothstep(22.0,27.0,abs(hp.x))*(1.0-smoothstep(46.0,51.0,abs(hp.x)));
 float level=hp.z<24.8?11.4:hp.z<36.7?24.8:36.7;
 float rise=max(0.0,hp.z-level),vertical=1.0-abs(wn.z);
 float column=pow(abs(hn.x),3.0)*beam(hp.y+33.1,5.55,1.0+rise*.09)+pow(abs(hn.y),3.0)*beam(hp.x+44.4,5.55,1.0+rise*.09);
 float tower_wash=tower*smoothstep(10.9,11.6,hp.z)*(.28+column*1.75)*exp(-rise*.052);
 float wash=(.18+beam(hp.x,7.2,1.25+hp.z*.035)*.42)*exp(-max(0.0,hp.z-5.0)*.012);
 float cornice=exp(-pow((hp.z-24.85)/.24,2.0))+exp(-pow((hp.z-36.85)/.24,2.0))+exp(-pow((hp.z-43.65)/.35,2.0));
 float foundation=(1.0-smoothstep(7.0,11.4,hp.z))*beam(hp.x,9.5,.85+hp.z*.16)*1.2;
 float recess=smoothstep(.025,.30,dot(color,vec3(.2126,.7152,.0722)));
 EMISSION=color*vec3(1.8,.85,.23)*(wash+tower_wash+cornice*.58+foundation)*vertical*recess*(1.0-data.g)*night;
 // Photographic relief remains on stone, while the window glass stays smooth.
 vec2 relief=vec2(dFdx(data.r),dFdy(data.r))*(1.0-data.g)*.7;
 NORMAL=normalize(NORMAL+vec3(-relief,0.0));
}
