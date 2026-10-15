// Each room owns its random stream and next event. There is no target population,
// replacement light, shared time bucket or recurring city-wide lighting cycle.
function mixSeed(value) {
  value=Math.imul(value^(value>>>16),0x21f0aaad);
  value=Math.imul(value^(value>>>15),0x735a2d97);
  return (value^(value>>>15))>>>0;
}

export class RoomLightActivity {
  constructor(count,{seed=Math.floor(Math.random()*0xffffffff)}={}) {
    this.count=count;this.time=0;this.night=false;this.events=0;
    this.states=new Float32Array(count*4);
    this.randomStates=new Uint32Array(count);this.next=new Float64Array(count);
    this.heap=[];this.initialOn=0;
    for(let id=0;id<count;id++){
      this.randomStates[id]=mixSeed(seed^mixSeed(id+1))||1;
      const on=this.random(id)<.34?1:0;this.initialOn+=on;
      this.states.set([on,on,0,1],id*4);
      // Rooms have been occupied before the game starts: random residual dwell,
      // without a synchronized quiet period after startup.
      this.next[id]=this.exponential(id,on?420:840);this.push(id);
    }
  }
  random(id) {
    let x=this.randomStates[id];x^=x<<13;x^=x>>>17;x^=x<<5;this.randomStates[id]=x>>>0;
    return ((x>>>0)+.5)/4294967296;
  }
  exponential(id,mean){return -Math.log(1-this.random(id))*mean;}
  push(id){
    const heap=this.heap;let i=heap.length;heap.push(id);
    while(i>0){const parent=(i-1)>>1;if(this.next[heap[parent]]<=this.next[id])break;heap[i]=heap[parent];i=parent;}heap[i]=id;
  }
  pop(){
    const heap=this.heap,first=heap[0],last=heap.pop();if(!heap.length)return first;
    let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&this.next[heap[child+1]]<this.next[heap[child]])child++;
      if(this.next[last]<=this.next[heap[child]])break;heap[i]=heap[child];i=child;
    }heap[i]=last;return first;
  }
  setNight(enabled){this.night=Boolean(enabled);}
  intensity(id,time=this.time){
    const i=id*4,t=Math.max(0,Math.min(1,(time-this.states[i+2])/this.states[i+3]));
    return this.states[i]+(this.states[i+1]-this.states[i])*t*t*(3-2*t);
  }
  update(dt){
    if(!this.night||!Number.isFinite(dt)||dt<=0)return [];
    this.time+=dt;const changed=[];
    while(this.heap.length&&this.next[this.heap[0]]<=this.time){
      const id=this.pop(),at=this.next[id],i=id*4,on=this.states[i+1]===0;
      const from=this.intensity(id,at),fade=.65+this.random(id)*1.25;
      this.states.set([from,on?1:0,at,fade],i);
      this.next[id]=at+(on?75:90)+this.exponential(id,on?345:750);
      this.push(id);this.events++;changed.push(id);
    }
    return changed;
  }
}
