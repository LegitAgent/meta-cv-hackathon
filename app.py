from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
from ultralytics import YOLOWorld
from ultralytics.engine.results import Results

CLASSES = ["phone", "laptop", "dog", "headset"]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = YOLOWorld("yolov8s-worldv2.pt")
model.set_classes(CLASSES)


@app.get("/")
def home():
    return FileResponse("index.html")


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    data = await file.read()
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR) # convert img to bytes
    
    if img is None:
        return {"error": "Invalid image format"}
    
    preds = list(model.predict(img, save=False, verbose=False, conf=0.15)) # lower conf for smaller obj catching
    first = preds[0]
    assert isinstance(first, Results)
    
    boxes = first.boxes
    out = []
    
    if boxes is not None and len(boxes) > 0:
        for xyxy, cls, conf in zip(
            boxes.xyxy.tolist(), boxes.cls.tolist(), boxes.conf.tolist()
        ):
            class_id = int(cls)
            out.append(
                {
                    "label": CLASSES[class_id] if 0 <= class_id < len(CLASSES) else str(class_id),
                    "confidence": round(float(conf), 3),
                    "box": [round(float(v), 1) for v in xyxy],
                }
            )
    return {"detections": out}
