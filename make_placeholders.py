"""Throwaway placeholder strips so the layout has something to hold.
These get deleted the moment Octember uploads a real one."""
import math, random, os
from PIL import Image, ImageDraw, ImageFont

W, H = 900, 600
OUT = "src/static/images/comics"
os.makedirs(OUT, exist_ok=True)

def font(sz):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()

def wobbly_line(d, p1, p2, rnd, w=4, seg=14):
    """A straight line, drawn by a hand that isn't a ruler."""
    x1, y1 = p1; x2, y2 = p2
    pts = []
    for i in range(seg + 1):
        t = i / seg
        j = 0 if i in (0, seg) else rnd.uniform(-2.0, 2.0)
        pts.append((x1 + (x2 - x1) * t + j, y1 + (y2 - y1) * t + j))
    d.line(pts, fill=(30, 26, 22), width=w, joint="curve")

def wobbly_box(d, box, rnd, w=4):
    x1, y1, x2, y2 = box
    wobbly_line(d, (x1, y1), (x2, y1), rnd, w)
    wobbly_line(d, (x2, y1), (x2, y2), rnd, w)
    wobbly_line(d, (x2, y2), (x1, y2), rnd, w)
    wobbly_line(d, (x1, y2), (x1, y1), rnd, w)

def figure(d, cx, cy, s, rnd, arms="up"):
    ink = (30, 26, 22)
    d.ellipse([cx - 18 * s, cy - 46 * s, cx + 18 * s, cy - 10 * s], outline=ink, width=4)
    d.point((cx - 7 * s, cy - 32 * s)); d.point((cx + 7 * s, cy - 32 * s))
    d.ellipse([cx - 9 * s, cy - 34 * s, cx - 5 * s, cy - 30 * s], fill=ink)
    d.ellipse([cx + 5 * s, cy - 34 * s, cx + 9 * s, cy - 30 * s], fill=ink)
    d.arc([cx - 10 * s, cy - 28 * s, cx + 10 * s, cy - 16 * s], 20, 160, fill=ink, width=3)
    wobbly_line(d, (cx, cy - 10 * s), (cx, cy + 30 * s), rnd, 4)
    if arms == "up":
        wobbly_line(d, (cx, cy + 2 * s), (cx - 30 * s, cy - 18 * s), rnd, 4)
        wobbly_line(d, (cx, cy + 2 * s), (cx + 30 * s, cy - 18 * s), rnd, 4)
    else:
        wobbly_line(d, (cx, cy + 2 * s), (cx - 30 * s, cy + 16 * s), rnd, 4)
        wobbly_line(d, (cx, cy + 2 * s), (cx + 30 * s, cy + 16 * s), rnd, 4)
    wobbly_line(d, (cx, cy + 30 * s), (cx - 22 * s, cy + 60 * s), rnd, 4)
    wobbly_line(d, (cx, cy + 30 * s), (cx + 22 * s, cy + 60 * s), rnd, 4)

def bubble(d, cx, cy, text, rnd, f):
    tw = d.textlength(text, font=f)
    pad = 16
    box = [cx - tw / 2 - pad, cy - 22, cx + tw / 2 + pad, cy + 22]
    d.rounded_rectangle(box, radius=18, fill=(255, 255, 255), outline=(30, 26, 22), width=4)
    d.polygon([(cx - 10, box[3] - 2), (cx + 8, box[3] - 2), (cx - 4, box[3] + 20)],
              fill=(255, 255, 255), outline=(30, 26, 22))
    d.text((cx, cy), text, font=f, fill=(30, 26, 22), anchor="mm")

STRIPS = [
    ("hello-world.png", [("hi.", "up"), ("this is my website", "down"), ("cuz yes", "up")]),
    ("the-cat-situation.png", [("where is the cat", "down"), ("...", "down"), ("found her", "up")]),
    ("very-important.png", [("i drew a thing", "up"), ("is it good", "down"), ("yes", "up")]),
]

for name, panels in STRIPS:
    rnd = random.Random(name)
    img = Image.new("RGB", (W, H), (255, 253, 247))
    d = ImageDraw.Draw(img)
    f = font(26)
    pw = (W - 4 * 24) / 3
    for i, (line, arms) in enumerate(panels):
        x1 = 24 + i * (pw + 24)
        wobbly_box(d, (x1, 60, x1 + pw, H - 60), rnd)
        cx = x1 + pw / 2
        figure(d, cx, 380, 1.5, rnd, arms)
        bubble(d, cx, 160, line, rnd, f)
    d.text((W - 30, H - 26), "placeholder", font=font(18), fill=(180, 172, 160), anchor="rs")
    img.save(os.path.join(OUT, name), optimize=True)
    print("wrote", name)
