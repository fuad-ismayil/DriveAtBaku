extends RefCounted

var states = PackedFloat32Array()
var random_states = PackedInt64Array()
var next = PackedFloat64Array()
var heap: Array[int] = []
var time = 0.0
var events = 0

func _init(count: int, seed_value = 599):
	states.resize(count * 4)
	random_states.resize(count)
	next.resize(count)
	for id in count:
		random_states[id] = _seed(seed_value ^ _seed(id + 1))
		if random_states[id] == 0: random_states[id] = 1
		var on = 1.0 if random(id) < 0.34 else 0.0
		states[id * 4] = on
		states[id * 4 + 1] = on
		states[id * 4 + 3] = 1
		next[id] = exponential(id, 420 if on > 0 else 840)
		_push(id)

func _seed(value: int) -> int:
	value = ((value ^ (value >> 16)) * 0x21f0aaad) & 0xffffffff
	value = ((value ^ (value >> 15)) * 0x735a2d97) & 0xffffffff
	return (value ^ (value >> 15)) & 0xffffffff

func random(id: int) -> float:
	var x = random_states[id]
	x = (x ^ (x << 13)) & 0xffffffff
	x = x ^ (x >> 17)
	x = (x ^ (x << 5)) & 0xffffffff
	random_states[id] = x
	return (float(x) + 0.5) / 4294967296.0

func exponential(id: int, mean: float) -> float:
	return -log(1 - random(id)) * mean

func intensity(id: int, at: float) -> float:
	var i = id * 4
	return lerpf(states[i], states[i + 1], smoothstep(0.0, 1.0, (at - states[i + 2]) / states[i + 3]))

func update(dt: float) -> bool:
	if dt <= 0: return false
	time += dt
	var changed = false
	while not heap.is_empty() and next[heap[0]] <= time:
		var id = _pop()
		var at = next[id]
		var on = states[id * 4 + 1] == 0
		var from = intensity(id, at)
		var fade = 0.65 + random(id) * 1.25
		states[id * 4] = from
		states[id * 4 + 1] = 1 if on else 0
		states[id * 4 + 2] = at
		states[id * 4 + 3] = fade
		next[id] = at + (75 if on else 90) + exponential(id, 345 if on else 750)
		_push(id)
		events += 1
		changed = true
	return changed

func _push(id: int):
	var i = heap.size()
	heap.append(id)
	while i > 0:
		var parent = (i - 1) >> 1
		if next[heap[parent]] <= next[id]: break
		heap[i] = heap[parent]
		i = parent
	heap[i] = id

func _pop() -> int:
	var first = heap[0]
	var last = heap.pop_back()
	if heap.is_empty(): return first
	var i = 0
	while i * 2 + 1 < heap.size():
		var child = i * 2 + 1
		if child + 1 < heap.size() and next[heap[child + 1]] < next[heap[child]]: child += 1
		if next[last] <= next[heap[child]]: break
		heap[i] = heap[child]
		i = child
	heap[i] = last
	return first
