import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a base64 image string to Cloudinary.
 * Returns the secure URL.
 */
export async function uploadBase64Image(
    base64Str: string,
    folder: string,
    publicId: string
): Promise<string> {
    const result = await cloudinary.uploader.upload(base64Str, {
        folder,
        public_id: publicId,
        overwrite: true,
        resource_type: "image",
    });
    return result.secure_url;
}

/**
 * Upload a raw buffer (e.g. QR code PNG) to Cloudinary.
 * Returns the secure URL.
 */
export async function uploadBuffer(
    buffer: Buffer,
    folder: string,
    publicId: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, public_id: publicId, overwrite: true, resource_type: "image" },
            (error, result) => {
                if (error || !result) return reject(error);
                resolve(result.secure_url);
            }
        );
        stream.end(buffer);
    });
}

export default cloudinary;
