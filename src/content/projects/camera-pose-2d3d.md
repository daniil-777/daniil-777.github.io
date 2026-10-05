---
title: Camera Pose from a Point Cloud
tagline: Where was this photo taken? Matching pixels directly to 3D points.
summary: Master's thesis at ETH Zurich's Computer Vision Lab. Image and point-cloud features are learned jointly so that a single photo can be registered against a 3D scan to recover the camera's 6D pose. The method was filed as an international patent application.
category: research
year: 2021 – 2023
sortDate: 2021-10-20
organisation: ETH Zurich · Computer Vision Lab
role: Master's thesis
topics: [Computer Vision, 3D, Patent]
stack: [PyTorch, Point clouds, Blind PnP, Levenberg–Marquardt optimisation, Feature matching, Visual localisation]
highlights:
  - value: 5.75 / 6
    label: thesis grade
  - value: WO2023186262A1
    label: international patent application
  - value: 6D
    label: camera pose, from one image and one point cloud
documents:
  - id: camera-pose-patent
    kind: patent
    title: A method for determining the 6D pose of a camera used to acquire an image of a scene using a point cloud of the scene and features
    source: ETH/patent/WO2023186262A1.pdf
    original:
      label: Google Patents
      href: https://patents.google.com/patent/WO2023186262A1/en
cover: ../../assets/projects/camera-pose-2d3d/features-cover.png
gallery:
  - src: ../../assets/projects/camera-pose-2d3d/patent-fig2.png
    alt: Patent drawing. A point-cloud encoder and an image encoder each produce feature maps and confidence maps, which feed a Levenberg-Marquardt optimisation block that refines an initial coarse pose over three levels.
    caption: From the patent. Two encoders produce features and confidences; an optimisation block refines the pose from coarse to fine.
  - src: ../../assets/projects/camera-pose-2d3d/features.png
    alt: Grid of learned features and confidences for point clouds and images across four datasets.
    caption: Learned features and confidences on indoor and outdoor scenes. The model learns by itself which regions are worth matching.
  - src: ../../assets/projects/camera-pose-2d3d/matching.png
    alt: A temple photograph with all projected 3D points on the left and only the matched points on the right.
    caption: The blind PnP setup. Left, all 3D points projected into the image. Right, the points that have 2D matches.
---

## The problem

Given a 3D scan of a place and a single photograph, where was the camera? Solving it means finding which pixels correspond to which 3D points, and images and point clouds look nothing alike. Classical pipelines avoid the question by matching images to other images. When all you have is a point cloud, that route is closed. Recovering pose without known correspondences is the *blind Perspective-n-Point* problem.

## The approach

Learn features for both worlds at once, end to end.

- Two encoders, one for the image and one for the point cloud, produce multi-level feature maps together with confidence maps that say where the features can be trusted.
- A differentiable Levenberg–Marquardt block aligns the two by optimising the camera pose directly, from a coarse level to a fine one.
- Only the pose is supervised. The network discovers on its own which visual features are robust enough to match across the two modalities.

## Result

The method improved on the blind PnP benchmark and was competitive on localisation. The experiments also showed something useful about the modalities: image data is essential for blind PnP, while point clouds carry the features that matter for localisation.

The thesis was supervised by Prof. Luc Van Gool and advised by Dr. Danda Pani Paudel, Vaishakh Patil and Anton Obukhov. It was graded 5.75 out of 6 and led to the international patent application *A method for determining the 6D pose of a camera used to acquire an image of a scene using a point cloud of the scene and features*.
