import { Blob } from "@netlify/blobs";

export default async (req) => {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file) {
      return new Response(JSON.stringify({ error: "No file uploaded" }), {
        status: 400,
      });
    }

    const fileName = file.name.replace(/\s+/g, "-").toLowerCase();
    const blobStore = new Blob();

    // Save file to Netlify Blobs
    await blobStore.set(`tracks/${fileName}`, await file.arrayBuffer());

    // Build public URL
    const fileUrl = `https://fancy-croquembouche-35cfed.netlify.app/.netlify/blobs/tracks/${fileName}`;

    // Update catalog.json
    const catalogBlob = await blobStore.get("catalog.json");
    let catalog = catalogBlob ? JSON.parse(await catalogBlob.text()) : [];

    catalog.push({
      title: fileName.replace(".mp3", ""),
      url: fileUrl,
    });

    await blobStore.set("catalog.json", JSON.stringify(catalog, null, 2));

    return new Response(JSON.stringify({ success: true, url: fileUrl }), {
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
};
