from ultralytics import YOLOWorld

model = YOLOWorld("yolov8s-worldv2.pt")
model.set_classes(["phone", "laptop", "dog"])

results = model.predict("test.jpg")

print(results)
