require("dotenv").config();
const express = require("express");
const multer = require("multer");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 5000;

const upload = multer({ dest: "upload/" });
app.use(express.json({ limit: "10mb" }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
app.use(express.static("public"));

app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    const imagePath = req.file.path;
    const imageData = await fsPromises.readFile(imagePath, {
      encoding: "base64",
    });

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent([
      "Analyze this plant image and provide detailed analysis of its species, health, care recommendations, characteristics, care instructions, and any interesting facts. Provide the response in plain text without any markdown formatting.",
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: imageData,
        },
      },
    ]);

    const plantInfo = result.response.text();

    // Delete the uploaded image after processing
    await fsPromises.unlink(imagePath);

    res.json({
      result: plantInfo,
      image: `data:${req.file.mimetype};base64,${imageData}`,
    });
  } catch (error) {
    console.error("Error analyzing image:", error);
    res.status(500).json({ error: "An error occurred while analyzing the image" });
  }
});

app.post("/download", express.json(), async (req, res) => {
  const { result, image } = req.body;
  try {
    const reportsDir = path.join(__dirname, "reports");
    await fsPromises.mkdir(reportsDir, { recursive: true });

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 dimensions

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Centered Title
    page.drawText("Plant Analysis Report", {
      x: 200,
      y: 800,
      size: 20,
      font,
      color: rgb(0.2, 0.4, 0.6),
    });
    page.drawText(`Date: ${new Date().toLocaleDateString()}`, {
      x: 50,
      y: 770,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    });

    // Add the analysis result text with proper alignment
    const textLines = result.split("\n");
    let textY = 750;
    textLines.forEach((line) => {
      page.drawText(line, {
        x: 50,
        y: textY,
        size: 12,
        font,
        color: rgb(0, 0, 0),
        maxWidth: 500,
      });
      textY -= 18;
    });

    // Insert image with dynamic scaling
    if (image) {
      const mimeTypeMatch = image.match(/^data:(image\/[^;]+);base64,/);
      if (!mimeTypeMatch) {
        return res.status(400).json({ error: "Invalid image format. Only JPEG and PNG images are supported." });
      }

      const format = mimeTypeMatch[1];
      if (format !== "image/jpeg" && format !== "image/png") {
        return res.status(400).json({ error: "Unsupported image format. Please upload a JPEG or PNG image." });
      }

      try {
        // Decode base64 data
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");

        // Embed either JPEG or PNG based on format
        const embeddedImage = format === "image/jpeg" 
          ? await pdfDoc.embedJpg(buffer) 
          : await pdfDoc.embedPng(buffer);

        const { width, height } = embeddedImage.scale(0.5);
        page.drawImage(embeddedImage, {
          x: 100,
          y: textY - height - 20,
          width: width,
          height: height,
        });
      } catch (imageError) {
        console.error("Error embedding image:", imageError);
        return res.status(500).json({ error: "Failed to embed image in the PDF. Please verify that the image is a valid JPEG or PNG format." });
      }
    }

    const pdfBytes = await pdfDoc.save();
    const filename = `plant_analysis_report_${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, filename);

    await fsPromises.writeFile(filePath, pdfBytes);

    // Serve the PDF report for download and delete after download
    res.download(filePath, (err) => {
      if (err) {
        console.error("Error downloading PDF:", err);
        return res.status(500).json({ error: "Error downloading the PDF report" });
      }
      fsPromises.unlink(filePath);
    });
  } catch (error) {
    console.error("Error generating PDF report:", error);
    res.status(500).json({ error: "An error occurred while generating the PDF report" });
  }
});





app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
