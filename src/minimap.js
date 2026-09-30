import * as THREE from 'three';

export function drawMinimap(canvas, route, position, heading, speedMps = 0) {
  const context = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 9;
  const scale = THREE.MathUtils.lerp(0.39, 0.24, THREE.MathUtils.clamp(speedMps / 55, 0, 1));
  const forwardX = -Math.sin(heading), forwardY = Math.cos(heading);
  const rightX = forwardY, rightY = -forwardX;
  const project = point => {
    const dx = point[0] - position.x;
    const dy = point[1] - position.y;
    return [center + (dx * rightX + dy * rightY) * scale, center - (dx * forwardX + dy * forwardY) * scale];
  };

  context.clearRect(0, 0, size, size);
  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = '#0a2735';
  context.fillRect(0, 0, size, size);
  context.fillStyle = 'rgba(116, 179, 197, 0.06)';
  for (let x = center % 22; x < size; x += 22) context.fillRect(x, 0, 1, size);
  for (let y = center % 22; y < size; y += 22) context.fillRect(0, y, size, 1);
  context.strokeStyle = 'rgba(128, 210, 224, 0.11)';
  context.lineWidth = 1;
  for (const ring of [radius * 0.4, radius * 0.8]) {
    context.beginPath();
    context.arc(center, center, ring, 0, Math.PI * 2);
    context.stroke();
  }

  const checkpoints = route.checkpoints;
  context.beginPath();
  checkpoints.forEach((point, index) => {
    const [x, y] = project(point);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  const [firstX, firstY] = project(checkpoints[0]);
  context.lineTo(firstX, firstY);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.strokeStyle = '#03141e';
  context.lineWidth = 17;
  context.stroke();
  context.strokeStyle = 'rgba(78, 183, 196, 0.38)';
  context.lineWidth = 10;
  context.stroke();
  context.shadowColor = '#69e5ec';
  context.shadowBlur = 9;
  context.strokeStyle = '#8cebf0';
  context.lineWidth = 3.5;
  context.stroke();
  context.shadowBlur = 0;

  const nearest = checkpoints.reduce((best, point, index) => {
    const distance = (point[0] - position.x) ** 2 + (point[1] - position.y) ** 2;
    return distance < best.distance ? { index, distance } : best;
  }, { index: 0, distance: Infinity }).index;
  const [nextX, nextY] = project(checkpoints[(nearest + 1) % checkpoints.length]);
  context.fillStyle = '#f9a06d';
  context.beginPath();
  context.arc(nextX, nextY, 4.5, 0, Math.PI * 2);
  context.fill();

  context.translate(center, center);
  context.fillStyle = 'rgba(0, 11, 18, 0.8)';
  context.beginPath();
  context.arc(0, 0, 17, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#7ee5e9';
  context.lineWidth = 1.5;
  context.stroke();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.moveTo(0, -12);
  context.lineTo(-7, 9);
  context.lineTo(0, 5);
  context.lineTo(7, 9);
  context.closePath();
  context.fill();
  context.restore();
  context.strokeStyle = 'rgba(172, 224, 229, 0.35)';
  context.lineWidth = 1;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.stroke();
}
