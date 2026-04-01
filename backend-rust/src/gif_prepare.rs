#[cfg(windows)]
use std::f32::consts::PI;
#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::path::{Path, PathBuf};

#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
#[cfg(windows)]
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_ContainerFormatGif, GUID_WICPixelFormat32bppBGRA, GUID_WICPixelFormat8bppIndexed,
    IWICBitmap, IWICBitmapDecoder, IWICBitmapEncoder, IWICBitmapFrameDecode, IWICBitmapFrameEncode, IWICFormatConverter,
    IWICImagingFactory, IWICPalette, IWICStream, WICBitmapDitherTypeErrorDiffusion, WICBitmapEncoderNoCache,
    WICBitmapPaletteTypeCustom, WICDecodeMetadataCacheOnLoad,
};
#[cfg(windows)]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};

#[cfg(windows)]
// Preserve source timing as closely as possible; only replace 0cs delays.
const DEFAULT_DELAY_CS: u16 = 1;

#[cfg(windows)]
pub struct PreparedGif {
    pub bytes: Vec<u8>,
}

#[cfg(windows)]
#[derive(Clone)]
struct GifFrameMetadata {
    left: u16,
    top: u16,
    width: u16,
    height: u16,
    disposal: u8,
}

#[cfg(windows)]
pub fn prepare_gif_for_device(
    asset_path: &Path,
    width: u16,
    height: u16,
    rotation: i32,
    zoom: f32,
    pan_x: f32,
    pan_y: f32,
    max_bytes: usize,
    mut emit_progress: impl FnMut(u8, &str),
) -> Result<PreparedGif, String> {
    let _com = ComScope::new()?;
    let source_bytes = fs::read(asset_path).map_err(|error| format!("Could not read GIF: {}", error))?;
    let metadata = parse_gif_metadata(&source_bytes);
    let factory = create_factory()?;

    emit_progress(18, "Loading GIF...");
    let decoder = create_decoder(&factory, asset_path)?;
    let frame_count = unsafe { decoder.GetFrameCount() }.map_err(winerr("Could not count GIF frames"))?;
    if frame_count == 0 {
        return Err("No frames found in GIF".to_string());
    }

    let mut rendered_frames = Vec::new();
    let mut composed_frame: Option<DecodedFrame> = None;
    let mut previous_frame_meta: Option<GifFrameMetadata> = None;
    for frame_index in 0..frame_count {
        let frame = unsafe { decoder.GetFrame(frame_index) }.map_err(winerr("Could not decode GIF frame"))?;
        let decoded = decode_frame(&factory, &frame)?;
        trace_decoded_frame(frame_index, &decoded);
        let frame_meta = metadata
            .frames
            .get(frame_index as usize)
            .cloned()
            .unwrap_or_else(|| GifFrameMetadata {
                left: 0,
                top: 0,
                width: decoded.width as u16,
                height: decoded.height as u16,
                disposal: 2,
            });
        let composited = composite_over_previous(
            composed_frame.as_ref(),
            previous_frame_meta.as_ref(),
            &decoded,
            &frame_meta,
            metadata.canvas_width as u32,
            metadata.canvas_height as u32,
        );
        let transformed = transform_frame(
            &composited,
            width as u32,
            height as u32,
            rotation,
            zoom,
            pan_x,
            pan_y,
        );
        composed_frame = Some(composited);
        previous_frame_meta = Some(frame_meta);
        rendered_frames.push(transformed);
        let ratio = (frame_index + 1) as f32 / frame_count as f32;
        let progress = 20.0 + (ratio * 28.0);
        emit_progress(progress.round() as u8, &format!("Decoded {}/{} GIF frames...", frame_index + 1, frame_count));
    }

    emit_progress(52, "Encoding device-ready GIF...");
    let encoded = fit_gif_to_memory(
        &factory,
        &rendered_frames,
        width as u32,
        height as u32,
        &metadata,
        max_bytes,
        &mut emit_progress,
    )?;

    emit_progress(72, "GIF optimized for LCD.");
    Ok(PreparedGif { bytes: encoded })
}

#[cfg(windows)]
struct ComScope {
    uninitialize: bool,
}

#[cfg(windows)]
impl ComScope {
    fn new() -> Result<Self, String> {
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if result.is_ok() {
            Ok(Self { uninitialize: true })
        } else if result.0 == 0x80010106u32 as i32 {
            Ok(Self { uninitialize: false })
        } else {
            Err(format!("Could not initialize COM for GIF processing: HRESULT 0x{:08X}", result.0 as u32))
        }
    }
}

#[cfg(windows)]
impl Drop for ComScope {
    fn drop(&mut self) {
        if self.uninitialize {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

#[cfg(windows)]
fn create_factory() -> Result<IWICImagingFactory, String> {
    unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER) }
        .map_err(|error| format!("Could not create WIC imaging factory: {}", error.message()))
}

#[cfg(windows)]
fn create_decoder(factory: &IWICImagingFactory, asset_path: &Path) -> Result<IWICBitmapDecoder, String> {
    let path_wide = to_wide(asset_path);
    unsafe {
        factory.CreateDecoderFromFilename(
            PCWSTR(path_wide.as_ptr()),
            None,
            GENERIC_READ,
            WICDecodeMetadataCacheOnLoad,
        )
    }
    .map_err(|error| format!("Could not open GIF decoder: {}", error.message()))
}

#[cfg(windows)]
fn decode_frame(factory: &IWICImagingFactory, frame: &IWICBitmapFrameDecode) -> Result<DecodedFrame, String> {
    let mut width = 0;
    let mut height = 0;
    unsafe { frame.GetSize(&mut width, &mut height) }.map_err(winerr("Could not query GIF frame size"))?;

    let converter: IWICFormatConverter = unsafe { factory.CreateFormatConverter() }
        .map_err(winerr("Could not create WIC format converter"))?;
    unsafe {
        converter.Initialize(
            frame,
            &GUID_WICPixelFormat32bppBGRA,
            WICBitmapDitherTypeErrorDiffusion,
            None,
            0.0,
            WICBitmapPaletteTypeCustom,
        )
    }
    .map_err(winerr("Could not convert GIF frame pixels"))?;

    let stride = width as usize * 4;
    let mut pixels = vec![0u8; stride * height as usize];
    unsafe { converter.CopyPixels(std::ptr::null(), stride as u32, pixels.as_mut_slice()) }
        .map_err(winerr("Could not copy GIF frame pixels"))?;

    Ok(DecodedFrame {
        width,
        height,
        pixels,
    })
}

#[cfg(windows)]
fn composite_over_previous(
    previous: Option<&DecodedFrame>,
    previous_meta: Option<&GifFrameMetadata>,
    current: &DecodedFrame,
    current_meta: &GifFrameMetadata,
    canvas_width: u32,
    canvas_height: u32,
) -> DecodedFrame {
    let mut pixels = match previous {
        Some(frame) if frame.width == canvas_width && frame.height == canvas_height => frame.pixels.clone(),
        _ => vec![0u8; canvas_width as usize * canvas_height as usize * 4],
    };

    if let Some(previous_meta) = previous_meta {
        if previous_meta.disposal == 2 {
            clear_rect(
                &mut pixels,
                canvas_width,
                canvas_height,
                previous_meta.left as u32,
                previous_meta.top as u32,
                previous_meta.width as u32,
                previous_meta.height as u32,
            );
        }
    }

    let copy_height = current.height.min(current_meta.height as u32);
    let copy_width = current.width.min(current_meta.width as u32);
    for y in 0..copy_height {
        let dest_y = current_meta.top as u32 + y;
        if dest_y >= canvas_height {
            break;
        }
        for x in 0..copy_width {
            let dest_x = current_meta.left as u32 + x;
            if dest_x >= canvas_width {
                break;
            }
            let src_offset = ((y * current.width + x) * 4) as usize;
            let dest_offset = ((dest_y * canvas_width + dest_x) * 4) as usize;
            composite_pixel(&mut pixels[dest_offset..dest_offset + 4], &current.pixels[src_offset..src_offset + 4]);
        }
    }

    DecodedFrame {
        width: canvas_width,
        height: canvas_height,
        pixels,
    }
}

#[cfg(windows)]
fn clear_rect(
    pixels: &mut [u8],
    canvas_width: u32,
    canvas_height: u32,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
) {
    let max_y = (top + height).min(canvas_height);
    let max_x = (left + width).min(canvas_width);
    for y in top..max_y {
        for x in left..max_x {
            let offset = ((y * canvas_width + x) * 4) as usize;
            pixels[offset..offset + 4].fill(0);
        }
    }
}

#[cfg(windows)]
fn composite_pixel(dest: &mut [u8], src: &[u8]) {
    let src_a = src[3] as u16;
    if src_a == 0 {
        return;
    }
    if src_a == 255 {
        dest.copy_from_slice(src);
        return;
    }

    let inv_a = 255u16.saturating_sub(src_a);
    dest[0] = (((src[0] as u16 * src_a) + (dest[0] as u16 * inv_a)) / 255) as u8;
    dest[1] = (((src[1] as u16 * src_a) + (dest[1] as u16 * inv_a)) / 255) as u8;
    dest[2] = (((src[2] as u16 * src_a) + (dest[2] as u16 * inv_a)) / 255) as u8;
    dest[3] = 255;
}

#[cfg(windows)]
fn encode_prepared_gif(
    factory: &IWICImagingFactory,
    frames: &[Vec<u8>],
    width: u32,
    height: u32,
    delays_cs: &[u16],
    loop_count: u16,
    max_colors: u32,
    emit_progress: &mut impl FnMut(u8, &str),
) -> Result<Vec<u8>, String> {
    let global_palette = build_global_palette(factory, frames, width, height, max_colors)?;
    let mut parsed_frames = Vec::with_capacity(frames.len());

    for (frame_index, frame_pixels) in frames.iter().enumerate() {
        let progress = 54.0 + (frame_index as f32 / frames.len().max(1) as f32) * 14.0;
        emit_progress(progress.round() as u8, &format!("Encoding frame {}/{}...", frame_index + 1, frames.len()));
        let single_frame_gif = encode_single_frame_gif(
            factory,
            frame_pixels,
            width,
            height,
            &global_palette,
        )?;
        parsed_frames.push(parse_single_frame_gif(&single_frame_gif)?);
    }

    let header_palette = parsed_frames
        .first()
        .map(|frame| frame.palette_rgb.clone())
        .unwrap_or_else(|| vec![0; 256 * 3]);
    Ok(assemble_gif(
        width as u16,
        height as u16,
        &header_palette,
        &parsed_frames,
        delays_cs,
        loop_count,
    ))
}

#[cfg(windows)]
fn build_global_palette(
    factory: &IWICImagingFactory,
    frames: &[Vec<u8>],
    width: u32,
    height: u32,
    max_colors: u32,
) -> Result<IWICPalette, String> {
    let palette_source = build_palette_sample(frames, width, height);
    let sample_height = (palette_source.len() / (width as usize * 4)).max(1) as u32;
    let bitmap = create_bitmap_from_bgra(factory, &palette_source, width, sample_height)?;
    let palette: IWICPalette = unsafe { factory.CreatePalette() }.map_err(winerr("Could not create GIF palette"))?;
    unsafe { palette.InitializeFromBitmap(&bitmap, max_colors.clamp(2, 256), false) }
        .map_err(winerr("Could not initialize global GIF palette"))?;
    Ok(palette)
}

#[cfg(windows)]
fn encode_single_frame_gif(
    factory: &IWICImagingFactory,
    frame_pixels: &[u8],
    width: u32,
    height: u32,
    palette: &IWICPalette,
) -> Result<Vec<u8>, String> {
    let temp_path = temporary_output_path();
    let temp_wide = to_wide(&temp_path);
    let stream: IWICStream = unsafe { factory.CreateStream() }.map_err(winerr("Could not create WIC stream"))?;
    unsafe { stream.InitializeFromFilename(PCWSTR(temp_wide.as_ptr()), GENERIC_WRITE.0) }
        .map_err(winerr("Could not initialize GIF output stream"))?;

    let encoder: IWICBitmapEncoder =
        unsafe { factory.CreateEncoder(&GUID_ContainerFormatGif, std::ptr::null()) }
            .map_err(winerr("Could not create GIF encoder"))?;
    unsafe { encoder.Initialize(&stream, WICBitmapEncoderNoCache) }
        .map_err(winerr("Could not initialize GIF encoder"))?;
    unsafe { encoder.SetPalette(palette) }.map_err(winerr("Could not set GIF encoder palette"))?;

    let mut frame_encode: Option<IWICBitmapFrameEncode> = None;
    let mut property_bag = None;
    unsafe { encoder.CreateNewFrame(&mut frame_encode, &mut property_bag) }
        .map_err(winerr("Could not create GIF frame encoder"))?;
    let frame_encode = frame_encode.ok_or_else(|| "GIF frame encoder was not created".to_string())?;
    match property_bag.as_ref() {
        Some(property_bag) => unsafe { frame_encode.Initialize(property_bag) },
        None => unsafe {
            frame_encode.Initialize(
                None::<&windows::Win32::System::Com::StructuredStorage::IPropertyBag2>,
            )
        },
    }
    .map_err(winerr("Could not initialize GIF frame"))?;
    unsafe { frame_encode.SetSize(width, height) }.map_err(winerr("Could not set GIF frame size"))?;

    let mut pixel_format = GUID_WICPixelFormat8bppIndexed;
    unsafe { frame_encode.SetPixelFormat(&mut pixel_format) }.map_err(winerr("Could not set GIF frame pixel format"))?;

    let bitmap = create_bitmap_from_bgra(factory, frame_pixels, width, height)?;
    let converter: IWICFormatConverter = unsafe { factory.CreateFormatConverter() }
        .map_err(winerr("Could not create indexed GIF converter"))?;
    unsafe {
        converter.Initialize(
            &bitmap,
            &GUID_WICPixelFormat8bppIndexed,
            WICBitmapDitherTypeErrorDiffusion,
            Some(palette),
            0.0,
            WICBitmapPaletteTypeCustom,
        )
    }
    .map_err(winerr("Could not convert frame to indexed GIF pixels"))?;
    unsafe { frame_encode.WriteSource(&converter, std::ptr::null()) }
        .map_err(winerr("Could not write GIF frame pixels"))?;
    unsafe { frame_encode.Commit() }.map_err(winerr("Could not commit GIF frame"))?;
    unsafe { encoder.Commit() }.map_err(winerr("Could not finalize encoded GIF"))?;

    let bytes = fs::read(&temp_path).map_err(|error| format!("Could not read encoded GIF: {}", error))?;
    let _ = fs::remove_file(&temp_path);
    Ok(bytes)
}

#[cfg(windows)]
fn assemble_gif(
    width: u16,
    height: u16,
    palette_rgb: &[u8],
    frames: &[ParsedSingleFrameGif],
    delays_cs: &[u16],
    loop_count: u16,
) -> Vec<u8> {
    let (packed, padded_palette) = make_gif_palette_header(palette_rgb);
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"GIF89a");
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.push(packed);
    bytes.push(0x00);
    bytes.push(0x00);
    bytes.extend_from_slice(&padded_palette);
    insert_netscape_extension(&mut bytes, loop_count);

    for (index, frame) in frames.iter().enumerate() {
        let delay = delays_cs
            .get(index)
            .copied()
            .or_else(|| delays_cs.last().copied())
            .unwrap_or(DEFAULT_DELAY_CS)
            .max(DEFAULT_DELAY_CS);

        bytes.extend_from_slice(&[
            0x21, 0xF9, 0x04, 0x08, delay.to_le_bytes()[0], delay.to_le_bytes()[1], 0x00, 0x00,
        ]);
        bytes.extend_from_slice(&frame.image_block);
    }

    bytes.push(0x3B);
    bytes
}

#[cfg(windows)]
fn make_gif_palette_header(palette_rgb: &[u8]) -> (u8, Vec<u8>) {
    let palette_entries = (palette_rgb.len() / 3).max(2);
    let table_entries = palette_entries.next_power_of_two().clamp(2, 256);
    let size_bits = (table_entries.trailing_zeros() as u8).saturating_sub(1).min(7);
    let mut padded_palette = palette_rgb.to_vec();
    padded_palette.resize(table_entries * 3, 0);
    (0x80 | 0x70 | size_bits, padded_palette)
}

#[cfg(windows)]
struct ParsedSingleFrameGif {
    palette_rgb: Vec<u8>,
    image_block: Vec<u8>,
}

#[cfg(windows)]
fn parse_single_frame_gif(bytes: &[u8]) -> Result<ParsedSingleFrameGif, String> {
    if bytes.len() < 13 || &bytes[0..6] != b"GIF89a" {
        return Err("Single-frame GIF encoder produced invalid data".to_string());
    }

    let packed = bytes[10];
    if (packed & 0x80) == 0 {
        return Err("Single-frame GIF is missing a global palette".to_string());
    }
    let gct_entries = 1usize << (((packed & 0x07) as usize) + 1);
    let palette_len = gct_entries * 3;
    let palette_start = 13usize;
    let palette_end = palette_start + palette_len;
    if bytes.len() < palette_end {
        return Err("Single-frame GIF palette is truncated".to_string());
    }
    let palette_rgb = bytes[palette_start..palette_end].to_vec();

    let mut offset = palette_end;
    while offset < bytes.len() {
        match bytes[offset] {
            0x21 => {
                if offset + 1 >= bytes.len() {
                    break;
                }
                let label = bytes[offset + 1];
                if label == 0xF9 {
                    offset += 8;
                    continue;
                }
                offset += 2;
                while offset < bytes.len() {
                    let block_len = bytes[offset] as usize;
                    offset += 1;
                    if block_len == 0 {
                        break;
                    }
                    if offset + block_len > bytes.len() {
                        return Err("Single-frame GIF extension block is truncated".to_string());
                    }
                    offset += block_len;
                }
            }
            0x2C => {
                if offset + 9 >= bytes.len() {
                    return Err("Single-frame GIF image descriptor is truncated".to_string());
                }
                let descriptor_packed = bytes[offset + 9];
                if (descriptor_packed & 0x80) != 0 {
                    return Err("Single-frame GIF unexpectedly uses a local palette".to_string());
                }

                let mut end = offset + 10;
                if end >= bytes.len() {
                    return Err("Single-frame GIF image data is truncated".to_string());
                }
                end += 1;
                while end < bytes.len() {
                    let block_len = bytes[end] as usize;
                    end += 1;
                    if block_len == 0 {
                        break;
                    }
                    if end + block_len > bytes.len() {
                        return Err("Single-frame GIF image data block is truncated".to_string());
                    }
                    end += block_len;
                }
                return Ok(ParsedSingleFrameGif {
                    palette_rgb,
                    image_block: bytes[offset..end].to_vec(),
                });
            }
            0x3B => break,
            _ => return Err("Single-frame GIF contains unexpected data before image block".to_string()),
        }
    }

    Err("Single-frame GIF image block not found".to_string())
}

#[cfg(windows)]
fn build_palette_sample(frames: &[Vec<u8>], width: u32, height: u32) -> Vec<u8> {
    let max_sample_rows = 256u32;
    let frame_count = frames.len().max(1) as u32;
    let rows_per_frame = (max_sample_rows / frame_count).max(1);
    let step = (height / rows_per_frame).max(1);

    let mut sample = Vec::with_capacity(width as usize * 4 * (rows_per_frame * frame_count) as usize);
    for frame in frames {
        let mut sampled_rows = 0u32;
        let mut y = 0u32;
        while y < height && sampled_rows < rows_per_frame {
            let row_start = (y * width * 4) as usize;
            let row_end = row_start + (width * 4) as usize;
            sample.extend_from_slice(&frame[row_start..row_end]);
            sampled_rows += 1;
            y = y.saturating_add(step);
        }
    }

    if sample.is_empty() {
        sample.resize((width * 4) as usize, 0);
    }

    sample
}

#[cfg(windows)]
fn create_bitmap_from_bgra(
    factory: &IWICImagingFactory,
    pixels: &[u8],
    width: u32,
    height: u32,
) -> Result<IWICBitmap, String> {
    unsafe {
        factory.CreateBitmapFromMemory(
            width,
            height,
            &GUID_WICPixelFormat32bppBGRA,
            width * 4,
            pixels,
        )
    }
    .map_err(winerr("Could not create WIC bitmap from memory"))
}

#[cfg(windows)]
#[derive(Clone)]
struct DecodedFrame {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[cfg(windows)]
#[derive(Clone)]
struct GifMetadata {
    canvas_width: u16,
    canvas_height: u16,
    delays_cs: Vec<u16>,
    loop_count: u16,
    frames: Vec<GifFrameMetadata>,
}

#[cfg(windows)]
fn parse_gif_metadata(bytes: &[u8]) -> GifMetadata {
    let canvas_width = if bytes.len() >= 8 {
        u16::from_le_bytes([bytes[6], bytes[7]])
    } else {
        0
    };
    let canvas_height = if bytes.len() >= 10 {
        u16::from_le_bytes([bytes[8], bytes[9]])
    } else {
        0
    };
    let mut delays_cs = Vec::new();
    let mut loop_count = 0u16;
    let mut frames = Vec::new();
    let mut offset = 13usize;
    let mut pending_disposal = 2u8;

    if bytes.len() >= 13 {
        let packed = bytes[10];
        if (packed & 0x80) != 0 {
            let gct_entries = 1usize << (((packed & 0x07) as usize) + 1);
            offset += gct_entries * 3;
        }
    }

    while offset < bytes.len() {
        match bytes[offset] {
            0x21 => {
                if offset + 1 >= bytes.len() {
                    break;
                }
                let label = bytes[offset + 1];
                if label == 0xF9 && offset + 7 < bytes.len() {
                    let packed = bytes[offset + 3];
                    let delay = u16::from_le_bytes([bytes[offset + 4], bytes[offset + 5]]);
                    delays_cs.push(delay.max(DEFAULT_DELAY_CS));
                    pending_disposal = (packed >> 2) & 0x07;
                    offset += 8;
                    continue;
                }
                if label == 0xFF && offset + 14 < bytes.len() {
                    let block_size = bytes[offset + 2] as usize;
                    let app_id_start = offset + 3;
                    let app_id_end = app_id_start.saturating_add(block_size).min(bytes.len());
                    let app_id = &bytes[app_id_start..app_id_end];
                    offset = app_id_end;
                    while offset < bytes.len() {
                        let sub_len = bytes[offset] as usize;
                        offset += 1;
                        if sub_len == 0 || offset + sub_len > bytes.len() {
                            break;
                        }
                        if app_id == b"NETSCAPE2.0" && sub_len >= 3 && bytes[offset] == 0x01 {
                            loop_count = u16::from_le_bytes([bytes[offset + 1], bytes[offset + 2]]);
                        }
                        offset += sub_len;
                    }
                    continue;
                }

                offset += 2;
                while offset < bytes.len() {
                    let sub_len = bytes[offset] as usize;
                    offset += 1;
                    if sub_len == 0 || offset + sub_len > bytes.len() {
                        break;
                    }
                    offset += sub_len;
                }
            }
            0x2C => {
                if offset + 9 >= bytes.len() {
                    break;
                }
                let left = u16::from_le_bytes([bytes[offset + 1], bytes[offset + 2]]);
                let top = u16::from_le_bytes([bytes[offset + 3], bytes[offset + 4]]);
                let width = u16::from_le_bytes([bytes[offset + 5], bytes[offset + 6]]);
                let height = u16::from_le_bytes([bytes[offset + 7], bytes[offset + 8]]);
                let packed = bytes[offset + 9];
                frames.push(GifFrameMetadata {
                    left,
                    top,
                    width,
                    height,
                    disposal: pending_disposal,
                });
                pending_disposal = 2;
                offset += 10;
                if (packed & 0x80) != 0 {
                    let entries = 1usize << (((packed & 0x07) as usize) + 1);
                    offset += entries * 3;
                }
                if offset >= bytes.len() {
                    break;
                }
                offset += 1;
                while offset < bytes.len() {
                    let sub_len = bytes[offset] as usize;
                    offset += 1;
                    if sub_len == 0 || offset + sub_len > bytes.len() {
                        break;
                    }
                    offset += sub_len;
                }
            }
            0x3B => break,
            _ => break,
        }
    }

    if delays_cs.is_empty() {
        delays_cs.push(DEFAULT_DELAY_CS);
    }

    GifMetadata {
        canvas_width,
        canvas_height,
        delays_cs,
        loop_count,
        frames,
    }
}

fn insert_netscape_extension(bytes: &mut Vec<u8>, loop_count: u16) {
    if bytes.windows(11).any(|window| window == b"NETSCAPE2.0") {
        return;
    }
    if bytes.len() < 13 {
        return;
    }

    let packed = bytes[10];
    let mut insert_at = 13usize;
    if (packed & 0x80) != 0 {
        let gct_entries = 1usize << (((packed & 0x07) as usize) + 1);
        insert_at += gct_entries * 3;
    }
    insert_at = insert_at.min(bytes.len());

    let mut extension = vec![0x21, 0xFF, 0x0B];
    extension.extend_from_slice(b"NETSCAPE2.0");
    extension.push(0x03);
    extension.push(0x01);
    extension.extend_from_slice(&loop_count.to_le_bytes());
    extension.push(0x00);
    bytes.splice(insert_at..insert_at, extension);
}

#[cfg(windows)]
fn fit_gif_to_memory(
    factory: &IWICImagingFactory,
    rendered_frames: &[Vec<u8>],
    width: u32,
    height: u32,
    metadata: &GifMetadata,
    max_bytes: usize,
    emit_progress: &mut impl FnMut(u8, &str),
) -> Result<Vec<u8>, String> {
    let color_plans = [256u32, 192, 128, 96, 64, 48, 32, 24, 16];
    let stride_plans = [1usize, 2, 3, 4, 5, 6, 8, 10, 12];
    let mut smallest_len: Option<usize> = None;

    for &stride in &stride_plans {
        let selected_frames: Vec<Vec<u8>> = rendered_frames.iter().step_by(stride).cloned().collect();
        if selected_frames.is_empty() {
            continue;
        }
        let collapsed_delays = collapse_delays(&metadata.delays_cs, rendered_frames.len(), stride);

        for &max_colors in &color_plans {
            if stride > 1 || max_colors < 256 {
                emit_progress(
                    53,
                    &format!(
                        "Compressing GIF to fit {} MiB ({} colors, every {} frame{})...",
                        format_mib_limit(max_bytes),
                        max_colors,
                        stride,
                        if stride == 1 { "" } else { "s" }
                    ),
                );
            }

            let encoded = encode_prepared_gif(
                factory,
                &selected_frames,
                width,
                height,
                &collapsed_delays,
                metadata.loop_count,
                max_colors,
                emit_progress,
            )?;

            if smallest_len.map_or(true, |current| encoded.len() < current) {
                smallest_len = Some(encoded.len());
            }

            if encoded.len() <= max_bytes {
                return Ok(encoded);
            }
        }
    }

    Err(format!(
        "GIF is too large for device memory after compression ({}MiB limit, best result: {}MiB)",
        format_mib_limit(max_bytes),
        format_mib_limit(smallest_len.unwrap_or(max_bytes))
    ))
}

#[cfg(windows)]
fn collapse_delays(source_delays: &[u16], frame_count: usize, stride: usize) -> Vec<u16> {
    let normalized = normalized_delays(source_delays, frame_count);
    let mut collapsed = Vec::new();
    let mut index = 0usize;
    while index < normalized.len() {
        let end = (index + stride).min(normalized.len());
        let total = normalized[index..end]
            .iter()
            .fold(0u32, |acc, delay| acc.saturating_add(u32::from(*delay)));
        collapsed.push(total.clamp(u32::from(DEFAULT_DELAY_CS), u32::from(u16::MAX)) as u16);
        index = end;
    }
    collapsed
}

#[cfg(windows)]
fn normalized_delays(source_delays: &[u16], frame_count: usize) -> Vec<u16> {
    if frame_count == 0 {
        return Vec::new();
    }
    let fallback = source_delays.last().copied().unwrap_or(DEFAULT_DELAY_CS).max(DEFAULT_DELAY_CS);
    (0..frame_count)
        .map(|index| source_delays.get(index).copied().unwrap_or(fallback).max(DEFAULT_DELAY_CS))
        .collect()
}

#[cfg(windows)]
fn format_mib_limit(bytes: usize) -> String {
    format!("{:.1}", bytes as f32 / (1024.0 * 1024.0))
}

#[cfg(windows)]
fn transform_frame(
    source: &DecodedFrame,
    target_width: u32,
    target_height: u32,
    rotation: i32,
    zoom: f32,
    pan_x: f32,
    pan_y: f32,
) -> Vec<u8> {
    let source_width = source.width as f32;
    let source_height = source.height as f32;
    let normalized_rotation = ((rotation % 360) + 360) % 360;
    let (rotated_width, rotated_height) = if normalized_rotation % 180 == 0 {
        (source_width, source_height)
    } else {
        (source_height, source_width)
    };

    let zoom = zoom.max(1.0);
    let base_scale = (target_width as f32 / rotated_width).max(target_height as f32 / rotated_height);
    let scaled_width = ((rotated_width * base_scale * zoom).round() as u32).max(target_width);
    let scaled_height = ((rotated_height * base_scale * zoom).round() as u32).max(target_height);
    let crop_left = ((((pan_x.clamp(-1.0, 1.0) + 1.0) / 2.0) * (scaled_width.saturating_sub(target_width) as f32)).round())
        as f32;
    let crop_top = ((((pan_y.clamp(-1.0, 1.0) + 1.0) / 2.0) * (scaled_height.saturating_sub(target_height) as f32)).round())
        as f32;
    let scale_x = scaled_width as f32 / rotated_width;
    let scale_y = scaled_height as f32 / rotated_height;

    let source_center_x = (source_width - 1.0) / 2.0;
    let source_center_y = (source_height - 1.0) / 2.0;
    let rotated_center_x = (rotated_width - 1.0) / 2.0;
    let rotated_center_y = (rotated_height - 1.0) / 2.0;
    let radians = (normalized_rotation as f32) * PI / 180.0;
    let cos_a = radians.cos();
    let sin_a = radians.sin();

    let mut output = vec![0u8; target_width as usize * target_height as usize * 4];
    for y in 0..target_height {
        for x in 0..target_width {
            let rotated_x = (crop_left + x as f32 + 0.5) / scale_x - 0.5;
            let rotated_y = (crop_top + y as f32 + 0.5) / scale_y - 0.5;
            let dx = rotated_x - rotated_center_x;
            let dy = rotated_y - rotated_center_y;
            let source_x = cos_a * dx + sin_a * dy + source_center_x;
            let source_y = -sin_a * dx + cos_a * dy + source_center_y;

            let pixel = bilinear_sample_bgra(source, source_x, source_y);
            let dest_offset = ((y * target_width + x) * 4) as usize;
            let alpha = pixel[3] as u16;
            output[dest_offset] = ((pixel[0] as u16 * alpha) / 255) as u8;
            output[dest_offset + 1] = ((pixel[1] as u16 * alpha) / 255) as u8;
            output[dest_offset + 2] = ((pixel[2] as u16 * alpha) / 255) as u8;
            output[dest_offset + 3] = 255;
        }
    }

    output
}

#[cfg(windows)]
fn bilinear_sample_bgra(source: &DecodedFrame, x: f32, y: f32) -> [u8; 4] {
    if x < 0.0 || y < 0.0 || x > source.width as f32 - 1.0 || y > source.height as f32 - 1.0 {
        return [0, 0, 0, 255];
    }

    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let x1 = (x0 + 1).min(source.width as i32 - 1);
    let y1 = (y0 + 1).min(source.height as i32 - 1);
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;

    let p00 = read_bgra(source, x0 as u32, y0 as u32);
    let p10 = read_bgra(source, x1 as u32, y0 as u32);
    let p01 = read_bgra(source, x0 as u32, y1 as u32);
    let p11 = read_bgra(source, x1 as u32, y1 as u32);

    let mut out = [0u8; 4];
    for channel in 0..4 {
        let top = p00[channel] as f32 * (1.0 - fx) + p10[channel] as f32 * fx;
        let bottom = p01[channel] as f32 * (1.0 - fx) + p11[channel] as f32 * fx;
        out[channel] = (top * (1.0 - fy) + bottom * fy).round().clamp(0.0, 255.0) as u8;
    }
    out
}

#[cfg(windows)]
fn read_bgra(source: &DecodedFrame, x: u32, y: u32) -> [u8; 4] {
    let offset = ((y * source.width + x) * 4) as usize;
    [
        source.pixels[offset],
        source.pixels[offset + 1],
        source.pixels[offset + 2],
        source.pixels[offset + 3],
    ]
}

#[cfg(windows)]
fn trace_decoded_frame(frame_index: u32, frame: &DecodedFrame) {
    if std::env::var("KRAKEN_GIF_TRACE").ok().as_deref() != Some("1") {
        return;
    }

    let mut alpha_zero = 0usize;
    let mut alpha_full = 0usize;
    let mut alpha_partial = 0usize;
    for pixel in frame.pixels.chunks_exact(4) {
        match pixel[3] {
            0 => alpha_zero += 1,
            255 => alpha_full += 1,
            _ => alpha_partial += 1,
        }
    }

    eprintln!(
        "[gif-prepare] frame={} size={}x{} alpha_zero={} alpha_full={} alpha_partial={}",
        frame_index,
        frame.width,
        frame.height,
        alpha_zero,
        alpha_full,
        alpha_partial
    );
}

#[cfg(windows)]
fn to_wide(path: &Path) -> Vec<u16> {
    path.as_os_str().to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn temporary_output_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    let unique = format!(
        "kraken-unleashed-{}-{}.gif",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default()
    );
    path.push(unique);
    path
}

#[cfg(windows)]
fn winerr(prefix: &'static str) -> impl FnOnce(windows::core::Error) -> String {
    move |error| format!("{}: {}", prefix, error.message())
}
