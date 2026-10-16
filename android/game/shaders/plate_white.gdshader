shader_type spatial;
render_mode cull_back;
uniform vec4 tint : source_color = vec4(.94,.94,.914,1.0);
void fragment(){ALBEDO=tint.rgb;ROUGHNESS=.36;METALLIC=.06;CLEARCOAT=.25;CLEARCOAT_ROUGHNESS=.32;}
void light(){
 float nl=max(dot(NORMAL,LIGHT),0.0),nv=max(dot(NORMAL,VIEW),.0001);
 vec3 halfway=normalize(LIGHT+VIEW);
 float nh=max(dot(NORMAL,halfway),0.0),vh=max(dot(VIEW,halfway),0.0);
 float a=.36*.36,a2=a*a,denom=nh*nh*(a2-1.0)+1.0;
 float distribution=a2/(3.14159265*denom*denom);
 float k=pow(.36+1.0,2.0)/8.0;
 float visibility=nl/(nl*(1.0-k)+k)*nv/(nv*(1.0-k)+k);
 vec3 f0=mix(vec3(.04),ALBEDO,.06),fresnel=f0+(1.0-f0)*pow(1.0-vh,5.0);
 DIFFUSE_LIGHT+=(1.0-.06)/3.14159265*LIGHT_COLOR*nl*ATTENUATION;
 SPECULAR_LIGHT+=fresnel*distribution*visibility/max(4.0*nv*nl,.0001)*nl*LIGHT_COLOR*ATTENUATION;
 // The same bounded, post-shadow retroreflective lobe as licensePlates.js.
 // It reflects actual incident light and never makes the plate self-emissive.
 float alignment=pow(max(dot(VIEW,LIGHT),0.0),48.0);
 DIFFUSE_LIGHT+=LIGHT_COLOR*nl*alignment*.45*ATTENUATION;
}
