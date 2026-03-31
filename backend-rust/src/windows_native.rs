#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::io::{self, Write};
#[cfg(windows)]
use std::iter;
#[cfg(windows)]
use std::mem::size_of;
#[cfg(windows)]
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::ptr::null_mut;
#[cfg(windows)]
use std::slice;
#[cfg(windows)]
use std::thread;
#[cfg(windows)]
use std::time::Duration;
#[cfg(windows)]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use crate::SupportedDevice;
#[cfg(windows)]
use crate::gif_prepare::prepare_gif_for_device;

#[cfg(windows)]
use windows::core::{GUID, PCSTR, PCWSTR};
#[cfg(windows)]
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW,
    SetupDiGetDeviceInterfaceDetailW, DIGCF_DEVICEINTERFACE, DIGCF_PRESENT, HDEVINFO,
    SP_DEVICE_INTERFACE_DATA, SP_DEVICE_INTERFACE_DETAIL_DATA_W,
};
#[cfg(windows)]
use windows::Win32::Devices::HumanInterfaceDevice::{
    HidD_FreePreparsedData, HidD_GetAttributes, HidD_GetHidGuid, HidD_GetPreparsedData,
    HidD_GetSerialNumberString, HidD_SetNumInputBuffers, HidD_SetOutputReport, HidP_GetCaps,
    HIDD_ATTRIBUTES, HIDP_CAPS, HIDP_STATUS_SUCCESS,
};
#[cfg(windows)]
use windows::Win32::Devices::Usb::{
    WinUsb_Initialize, WinUsb_QueryPipe, WinUsb_WritePipe,
    UsbdPipeTypeBulk, WINUSB_INTERFACE_HANDLE, WINUSB_PIPE_INFORMATION,
};
#[cfg(windows)]
use windows::Win32::Foundation::{
    CloseHandle, FreeLibrary, FARPROC, GetLastError, HMODULE, ERROR_IO_PENDING,
    ERROR_NO_MORE_ITEMS, GENERIC_READ, GENERIC_WRITE, HANDLE,
};
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_ATTRIBUTE_NORMAL,
    FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_OVERLAPPED, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING,
};
#[cfg(windows)]
use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResultEx, OVERLAPPED};
#[cfg(windows)]
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
#[cfg(windows)]
use windows::Win32::System::Threading::CreateEventW;

#[cfg(windows)]
const NZXT_VID: u16 = 0x1E71;
#[cfg(windows)]
const DEFAULT_TIMEOUT_MS: u32 = 1000;
#[cfg(windows)]
const HID_PACKET_LENGTH: usize = 64;
#[cfg(windows)]
const MAX_READ_UNTIL_RETRIES: usize = 50;
#[cfg(windows)]
const BULK_WRITE_CHUNK_SIZE: usize = 64 * 1024;
#[cfg(windows)]
const BULK_OUT_ENDPOINT: u8 = 0x02;
#[cfg(windows)]
const USB_DEVICE_INTERFACE_GUID: GUID =
    GUID::from_u128(0xa5dcbf10_6530_11d2_901f_00c04fb951ed);
#[cfg(windows)]
const COMMON_WRITE_HEADER: [u8; 12] = [
    0x12, 0xFA, 0x01, 0xE8, 0xAB, 0xCD, 0xEF, 0x98, 0x76, 0x54, 0x32, 0x10,
];

#[cfg(windows)]
#[derive(Clone, Copy)]
enum DisplayMode {
    Liquid = 2,
    Bucket = 4,
}

#[cfg(windows)]
pub fn run_native_command(args: &[String], supported_devices: &[SupportedDevice]) -> Result<String, String> {
    match args.first().map(String::as_str) {
        Some("info") => {
            let (info, _serial, _hid_read_handle, _hid_write_handle, _hid_reports) =
                open_hid_device(supported_devices)?;
            Ok(format_device_info_json(info))
        }
        Some("brightness") => {
            let value = args
                .get(1)
                .ok_or_else(|| "Missing brightness value".to_string())?
                .parse::<u8>()
                .map_err(|_| "Brightness must be an integer".to_string())?;
            let mut device = open_control_device(supported_devices)?;
            device.set_brightness(value)?;
            Ok(format_message_json(&format!("Brightness set to {}%", value)))
        }
        Some("recover") => {
            let mut device = open_control_device(supported_devices)?;
            device.recover_liquid()?;
            Ok(format_message_json("Restored liquid display mode"))
        }
        Some("write") => {
            let asset_path = args.get(1).ok_or_else(|| "Missing asset path".to_string())?;
            let rotation = args
                .get(2)
                .and_then(|value| value.parse::<i32>().ok())
                .unwrap_or(0);
            let zoom = args
                .get(3)
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(1.0);
            let pan_x = args
                .get(4)
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(0.0);
            let pan_y = args
                .get(5)
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(0.0);

            let path = Path::new(asset_path);
            if !path.exists() {
                return Err(format!("File not found: {}", path.display()));
            }
            if path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("gif")) != Some(true) {
                return Err("Electron MVP only supports GIF deployment for now.".to_string());
            }

            emit_progress(12, "Opening Kraken interfaces...");
            let mut device = open_transfer_device(supported_devices)?;
            let prepared = prepare_gif_for_device(
                path,
                device.info.width,
                device.info.height,
                rotation,
                zoom,
                pan_x,
                pan_y,
                20 * 1024 * 1024,
                emit_progress,
            )?;
            emit_progress(73, "Exporting prepared GIF...");
            let exported_path = export_prepared_gif(path, &prepared.bytes)?;
            emit_progress(74, "Starting LCD transfer...");
            device.write_gif(&prepared.bytes)?;
            let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("asset.gif");
            Ok(format!(
                "{{\"message\":\"{}\",\"preparedGifPath\":\"{}\"}}",
                escape_for_json(&format!("Deployed {} to {}", file_name, device.info.name)),
                escape_for_json(&exported_path.display().to_string())
            ))
        }
        Some("prepare") => {
            let asset_path = args.get(1).ok_or_else(|| "Missing asset path".to_string())?;
            let output_path = args.get(2).ok_or_else(|| "Missing output path".to_string())?;
            let rotation = args
                .get(3)
                .and_then(|value| value.parse::<i32>().ok())
                .unwrap_or(0);
            let zoom = args
                .get(4)
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(1.0);
            let pan_x = args
                .get(5)
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(0.0);
            let pan_y = args
                .get(6)
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(0.0);

            let path = Path::new(asset_path);
            if !path.exists() {
                return Err(format!("File not found: {}", path.display()));
            }
            let output = Path::new(output_path);
            let prepared = prepare_gif_for_device(
                path,
                640,
                640,
                rotation,
                zoom,
                pan_x,
                pan_y,
                20 * 1024 * 1024,
                emit_progress,
            )?;
            std::fs::write(output, &prepared.bytes)
                .map_err(|error| format!("Could not write prepared GIF: {}", error))?;
            Ok(format_message_json(&format!("Prepared GIF written to {}", output.display())))
        }
        Some(command) => Err(format!("Unknown command: {}", command)),
        None => Err("Missing command".to_string()),
    }
}

#[cfg(not(windows))]
pub fn run_native_command(_args: &[String], _supported_devices: &[SupportedDevice]) -> Result<String, String> {
    Err("Native Rust backend is currently implemented for Windows only".to_string())
}

#[cfg(windows)]
struct KrakenDevice {
    info: SupportedDevice,
    serial: String,
    hid_read_handle: OwnedHandle,
    hid_write_handle: OwnedHandle,
    hid_reports: HidReportLengths,
    libusb: Option<LibUsbDevice>,
    bulk_handle: Option<OwnedHandle>,
    winusb: Option<WINUSB_INTERFACE_HANDLE>,
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug)]
struct HidReportLengths {
    input: usize,
    output: usize,
}

#[cfg(windows)]
#[repr(C)]
struct LibUsbContextOpaque {
    _private: [u8; 0],
}

#[cfg(windows)]
#[repr(C)]
struct LibUsbDeviceOpaque {
    _private: [u8; 0],
}

#[cfg(windows)]
#[repr(C)]
struct LibUsbDeviceHandleOpaque {
    _private: [u8; 0],
}

#[cfg(windows)]
#[allow(non_snake_case)]
#[repr(C)]
#[derive(Default)]
struct LibUsbDeviceDescriptor {
    bLength: u8,
    bDescriptorType: u8,
    bcdUSB: u16,
    bDeviceClass: u8,
    bDeviceSubClass: u8,
    bDeviceProtocol: u8,
    bMaxPacketSize0: u8,
    idVendor: u16,
    idProduct: u16,
    bcdDevice: u16,
    iManufacturer: u8,
    iProduct: u8,
    iSerialNumber: u8,
    bNumConfigurations: u8,
}

#[cfg(windows)]
#[allow(non_snake_case)]
#[repr(C)]
struct LibUsbEndpointDescriptor {
    bLength: u8,
    bDescriptorType: u8,
    bEndpointAddress: u8,
    bmAttributes: u8,
    wMaxPacketSize: u16,
    bInterval: u8,
    bRefresh: u8,
    bSynchAddress: u8,
    extra: *const u8,
    extra_length: i32,
}

#[cfg(windows)]
#[allow(non_snake_case)]
#[repr(C)]
struct LibUsbInterfaceDescriptor {
    bLength: u8,
    bDescriptorType: u8,
    bInterfaceNumber: u8,
    bAlternateSetting: u8,
    bNumEndpoints: u8,
    bInterfaceClass: u8,
    bInterfaceSubClass: u8,
    bInterfaceProtocol: u8,
    iInterface: u8,
    endpoint: *const LibUsbEndpointDescriptor,
    extra: *const u8,
    extra_length: i32,
}

#[cfg(windows)]
#[repr(C)]
struct LibUsbInterface {
    altsetting: *const LibUsbInterfaceDescriptor,
    num_altsetting: i32,
}

#[cfg(windows)]
#[allow(non_snake_case)]
#[repr(C)]
struct LibUsbConfigDescriptor {
    bLength: u8,
    bDescriptorType: u8,
    wTotalLength: u16,
    bNumInterfaces: u8,
    bConfigurationValue: u8,
    iConfiguration: u8,
    bmAttributes: u8,
    MaxPower: u8,
    interface: *const LibUsbInterface,
    extra: *const u8,
    extra_length: i32,
}

#[cfg(windows)]
type LibUsbInitFn = unsafe extern "C" fn(*mut *mut LibUsbContextOpaque) -> i32;
#[cfg(windows)]
type LibUsbExitFn = unsafe extern "C" fn(*mut LibUsbContextOpaque);
#[cfg(windows)]
type LibUsbOpenDeviceWithVidPidFn =
    unsafe extern "C" fn(*mut LibUsbContextOpaque, u16, u16) -> *mut LibUsbDeviceHandleOpaque;
#[cfg(windows)]
type LibUsbCloseFn = unsafe extern "C" fn(*mut LibUsbDeviceHandleOpaque);
#[cfg(windows)]
type LibUsbSetAutoDetachKernelDriverFn =
    unsafe extern "C" fn(*mut LibUsbDeviceHandleOpaque, i32) -> i32;
#[cfg(windows)]
type LibUsbClaimInterfaceFn = unsafe extern "C" fn(*mut LibUsbDeviceHandleOpaque, i32) -> i32;
#[cfg(windows)]
type LibUsbReleaseInterfaceFn = unsafe extern "C" fn(*mut LibUsbDeviceHandleOpaque, i32) -> i32;
#[cfg(windows)]
type LibUsbSetInterfaceAltSettingFn =
    unsafe extern "C" fn(*mut LibUsbDeviceHandleOpaque, i32, i32) -> i32;
#[cfg(windows)]
type LibUsbBulkTransferFn =
    unsafe extern "C" fn(*mut LibUsbDeviceHandleOpaque, u8, *mut u8, i32, *mut i32, u32) -> i32;
#[cfg(windows)]
type LibUsbGetDeviceFn =
    unsafe extern "C" fn(*mut LibUsbDeviceHandleOpaque) -> *mut LibUsbDeviceOpaque;
#[cfg(windows)]
type LibUsbGetDeviceDescriptorFn =
    unsafe extern "C" fn(*mut LibUsbDeviceOpaque, *mut LibUsbDeviceDescriptor) -> i32;
#[cfg(windows)]
type LibUsbGetActiveConfigDescriptorFn =
    unsafe extern "C" fn(*mut LibUsbDeviceOpaque, *mut *const LibUsbConfigDescriptor) -> i32;
#[cfg(windows)]
type LibUsbFreeConfigDescriptorFn = unsafe extern "C" fn(*const LibUsbConfigDescriptor);
#[cfg(windows)]
type LibUsbGetStringDescriptorAsciiFn =
    unsafe extern "C" fn(*mut LibUsbDeviceHandleOpaque, u8, *mut u8, i32) -> i32;

#[cfg(windows)]
#[derive(Clone, Copy)]
struct LibUsbApi {
    module: HMODULE,
    init: LibUsbInitFn,
    exit: LibUsbExitFn,
    open_device_with_vid_pid: LibUsbOpenDeviceWithVidPidFn,
    close: LibUsbCloseFn,
    set_auto_detach_kernel_driver: LibUsbSetAutoDetachKernelDriverFn,
    claim_interface: LibUsbClaimInterfaceFn,
    release_interface: LibUsbReleaseInterfaceFn,
    set_interface_alt_setting: LibUsbSetInterfaceAltSettingFn,
    bulk_transfer: LibUsbBulkTransferFn,
    get_device: LibUsbGetDeviceFn,
    get_device_descriptor: LibUsbGetDeviceDescriptorFn,
    get_active_config_descriptor: LibUsbGetActiveConfigDescriptorFn,
    free_config_descriptor: LibUsbFreeConfigDescriptorFn,
    get_string_descriptor_ascii: LibUsbGetStringDescriptorAsciiFn,
}

#[cfg(windows)]
struct LibUsbDevice {
    api: LibUsbApi,
    context: *mut LibUsbContextOpaque,
    device_handle: *mut LibUsbDeviceHandleOpaque,
    claimed_interface: i32,
}

#[cfg(windows)]
impl HidReportLengths {
    fn from_caps(caps: HIDP_CAPS) -> Self {
        Self {
            input: usize::from(caps.InputReportByteLength.max(HID_PACKET_LENGTH as u16)),
            output: usize::from(caps.OutputReportByteLength.max(HID_PACKET_LENGTH as u16)),
        }
    }

    fn output_offset(self) -> usize {
        self.output.saturating_sub(HID_PACKET_LENGTH).min(1)
    }
}

#[cfg(windows)]
impl LibUsbApi {
    fn load() -> Result<Self, String> {
        let module = unsafe {
            LoadLibraryW(PCWSTR(to_wide("libusb-1.0.dll").as_ptr()))
                .map_err(|error| format!("Could not load libusb-1.0.dll: {}", error.message()))?
        };

        unsafe {
            Ok(Self {
                module,
                init: load_libusb_symbol(module, b"libusb_init\0")?,
                exit: load_libusb_symbol(module, b"libusb_exit\0")?,
                open_device_with_vid_pid: load_libusb_symbol(
                    module,
                    b"libusb_open_device_with_vid_pid\0",
                )?,
                close: load_libusb_symbol(module, b"libusb_close\0")?,
                set_auto_detach_kernel_driver: load_libusb_symbol(
                    module,
                    b"libusb_set_auto_detach_kernel_driver\0",
                )?,
                claim_interface: load_libusb_symbol(module, b"libusb_claim_interface\0")?,
                release_interface: load_libusb_symbol(module, b"libusb_release_interface\0")?,
                set_interface_alt_setting: load_libusb_symbol(
                    module,
                    b"libusb_set_interface_alt_setting\0",
                )?,
                bulk_transfer: load_libusb_symbol(module, b"libusb_bulk_transfer\0")?,
                get_device: load_libusb_symbol(module, b"libusb_get_device\0")?,
                get_device_descriptor: load_libusb_symbol(
                    module,
                    b"libusb_get_device_descriptor\0",
                )?,
                get_active_config_descriptor: load_libusb_symbol(
                    module,
                    b"libusb_get_active_config_descriptor\0",
                )?,
                free_config_descriptor: load_libusb_symbol(
                    module,
                    b"libusb_free_config_descriptor\0",
                )?,
                get_string_descriptor_ascii: load_libusb_symbol(
                    module,
                    b"libusb_get_string_descriptor_ascii\0",
                )?,
            })
        }
    }
}

#[cfg(windows)]
impl LibUsbDevice {
    fn open(info: SupportedDevice, expected_serial: &str) -> Result<Self, String> {
        let api = LibUsbApi::load()?;
        let mut context = null_mut();
        let init_result = unsafe { (api.init)(&mut context) };
        if init_result != 0 {
            unsafe {
                let _ = FreeLibrary(api.module);
            }
            return Err(format!("libusb init failed: {}", init_result));
        }

        let device_handle = unsafe { (api.open_device_with_vid_pid)(context, NZXT_VID, info.pid) };
        if device_handle.is_null() {
            unsafe {
                (api.exit)(context);
                let _ = FreeLibrary(api.module);
            }
            return Err("libusb could not open Kraken bulk device".to_string());
        }

        if !expected_serial.is_empty() {
            let serial = unsafe { read_libusb_serial(&api, device_handle) };
            if let Ok(serial) = serial {
                trace_backend(&format!("libusb serial={}", serial));
                if !serial.eq_ignore_ascii_case(expected_serial) {
                    unsafe {
                        (api.close)(device_handle);
                        (api.exit)(context);
                        let _ = FreeLibrary(api.module);
                    }
                    return Err(format!(
                        "libusb device serial mismatch: expected {}, got {}",
                        expected_serial, serial
                    ));
                }
            }
        }

        let _ = unsafe { (api.set_auto_detach_kernel_driver)(device_handle, 1) };
        let (claimed_interface, _claimed_alt_setting) = claim_libusb_interface(&api, device_handle)?;
        Ok(Self {
            api,
            context,
            device_handle,
            claimed_interface,
        })
    }

    fn bulk_write(&mut self, bytes: &[u8], progress_range: Option<(u8, u8)>) -> Result<(), String> {
        let total_bytes = bytes.len().max(1);
        let mut sent_bytes = 0usize;
        for chunk in bytes.chunks(BULK_WRITE_CHUNK_SIZE) {
            let mut transferred = 0i32;
            let result = unsafe {
                (self.api.bulk_transfer)(
                    self.device_handle,
                    BULK_OUT_ENDPOINT,
                    chunk.as_ptr() as *mut u8,
                    chunk.len() as i32,
                    &mut transferred,
                    DEFAULT_TIMEOUT_MS,
                )
            };
            if result != 0 {
                return Err(format!("libusb bulk transfer failed: {}", result));
            }
            if transferred as usize != chunk.len() {
                return Err(format!(
                    "libusb bulk write incomplete: wrote {} of {} bytes",
                    transferred,
                    chunk.len()
                ));
            }
            sent_bytes += chunk.len();
            emit_transfer_progress(progress_range, sent_bytes, total_bytes);
        }

        Ok(())
    }
}

#[cfg(windows)]
impl Drop for LibUsbDevice {
    fn drop(&mut self) {
        unsafe {
            if !self.device_handle.is_null() {
                let _ = (self.api.release_interface)(self.device_handle, self.claimed_interface);
                (self.api.close)(self.device_handle);
            }
            if !self.context.is_null() {
                (self.api.exit)(self.context);
            }
            let _ = FreeLibrary(self.api.module);
        }
    }
}

#[cfg(windows)]
impl Drop for KrakenDevice {
    fn drop(&mut self) {
        if let Some(winusb) = self.winusb {
            if winusb.is_invalid() {
                return;
            }
            unsafe {
                let _ = windows::Win32::Devices::Usb::WinUsb_Free(winusb);
                self.winusb = None;
            }
        }
    }
}

#[cfg(windows)]
impl KrakenDevice {
    fn set_brightness(&mut self, brightness: u8) -> Result<(), String> {
        self.write_packet(&[
            0x30,
            0x02,
            0x01,
            brightness.clamp(0, 100),
            0x00,
            0x00,
            0x01,
            0x03,
        ])?;
        Ok(())
    }

    fn recover_liquid(&mut self) -> Result<(), String> {
        self.clear_hid();
        let _ = self.write_packet(&[0x36, 0x03]);
        let _ = self.read_until(&[[0x37, 0x03]], DEFAULT_TIMEOUT_MS);
        self.clear_hid();
        let _ = self.set_lcd_mode(DisplayMode::Liquid, 0);
        Ok(())
    }

    fn write_gif(&mut self, gif_data: &[u8]) -> Result<(), String> {
        if gif_data.len() > 20 * 1024 * 1024 {
            return Err("GIF is too large for device memory (20.0MiB)".to_string());
        }

        emit_progress(84, "Preparing LCD for transfer...");
        self.clear_hid();
        let _ = self.set_lcd_mode(DisplayMode::Liquid, 0);
        thread::sleep(Duration::from_millis(200));
        self.clear_hid();
        let _ = self.write_packet(&[0x36, 0x03]);
        let _ = self.read_until(&[[0x37, 0x03]], DEFAULT_TIMEOUT_MS);
        self.clear_hid();
        emit_progress(88, "Clearing previous GIF buckets...");
        self.delete_all_buckets()?;
        self.clear_hid();
        emit_progress(91, "Allocating GIF bucket...");
        self.create_bucket(0, gif_data.len())?;
        self.clear_hid();
        self.write_gif_bucket(gif_data, 0)?;
        self.clear_hid();
        emit_progress(98, "Finalizing LCD display...");
        self.set_lcd_mode(DisplayMode::Bucket, 0)?;
        Ok(())
    }

    fn initialize(&mut self) {
        self.clear_hid();
        let _ = self.write_packet(&[0x70, 0x02, 0x01, 0xB8, 0x01]);
        let _ = self.write_packet(&[0x70, 0x01]);
        let _ = self.write_packet(&[0x10, 0x01]);
        let _ = self.read_until(&[[0x11, 0x01]], DEFAULT_TIMEOUT_MS);
        let _ = self.write_packet(&[0x30, 0x01]);
        let _ = self.read_until(&[[0x31, 0x01]], DEFAULT_TIMEOUT_MS);
        self.clear_hid();
        let _ = self.write_packet(&[0x36, 0x03]);
        let _ = self.set_brightness(100);
    }

    fn set_lcd_mode(&mut self, mode: DisplayMode, bucket: u8) -> Result<(), String> {
        self.write_packet(&[0x38, 0x01, mode as u8, bucket])?;
        let packet = self.read_until(&[[0x39, 0x01]], DEFAULT_TIMEOUT_MS)?;
        parse_standard_result(&packet, "Could not switch LCD mode")
    }

    fn delete_bucket(&mut self, bucket: u8) -> Result<bool, String> {
        self.write_packet(&[0x32, 0x02, bucket])?;
        let packet = self.read_until(&[[0x33, 0x02]], DEFAULT_TIMEOUT_MS)?;
        Ok(packet_status(&packet) == 1)
    }

    fn delete_all_buckets(&mut self) -> Result<(), String> {
        for bucket in 0..16u8 {
            let mut deleted = false;
            for _ in 0..10 {
                if self.delete_bucket(bucket)? {
                    deleted = true;
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
            if !deleted {
                return Err(format!("Could not delete bucket {}", bucket));
            }
        }
        Ok(())
    }

    fn create_bucket(&mut self, bucket: u8, size: usize) -> Result<(), String> {
        let size_kib = ((size as f64 / 1024.0).ceil() as u16).saturating_add(1);
        let size_bytes = size_kib.to_le_bytes();
        self.write_packet(&[
            0x32,
            0x01,
            bucket,
            bucket.saturating_add(1),
            0x00,
            0x00,
            size_bytes[0],
            size_bytes[1],
            0x01,
        ])?;
        let packet = self.read_until(&[[0x33, 0x01]], DEFAULT_TIMEOUT_MS)?;
        let status = packet_status(&packet);
        if status == 1 || status == 4 {
            Ok(())
        } else {
            Err(format!("Could not create GIF bucket (status {})", status))
        }
    }

    fn write_gif_bucket(&mut self, gif_data: &[u8], bucket: u8) -> Result<(), String> {
        emit_progress(93, "Starting GIF transfer...");
        self.write_packet(&[0x36, 0x01, bucket])?;
        let start = self.read_until(&[[0x37, 0x01]], DEFAULT_TIMEOUT_MS)?;
        parse_standard_result(&start, "Could not start GIF write")?;

        let mut header = COMMON_WRITE_HEADER.to_vec();
        header.extend_from_slice(&[0x01, 0x00, 0x00, 0x00]);
        header.extend_from_slice(&(gif_data.len() as u32).to_le_bytes());
        self.bulk_write(&header)?;
        self.bulk_write_with_progress(gif_data, 94, 97)?;

        self.write_packet(&[0x36, 0x02])?;
        match self.read_until(&[[0x37, 0x02]], DEFAULT_TIMEOUT_MS) {
            Ok(end) => parse_standard_result(&end, "Could not finalize GIF write"),
            Err(_) => Ok(()),
        }
    }

    fn bulk_write(&mut self, bytes: &[u8]) -> Result<(), String> {
        if let Some(libusb) = self.libusb.as_mut() {
            return libusb.bulk_write(bytes, None);
        }

        let total_bytes = bytes.len().max(1);
        let mut sent_bytes = 0usize;
        for chunk in bytes.chunks(BULK_WRITE_CHUNK_SIZE) {
            let mut written = 0u32;
            let interface = self
                .winusb
                .ok_or_else(|| "Bulk interface is not connected".to_string())?;
            unsafe {
                WinUsb_WritePipe(interface, BULK_OUT_ENDPOINT, chunk, Some(&mut written), None)
                    .map_err(|error| format!("Bulk write failed: {}", error.message()))?;
            }
            if written as usize != chunk.len() {
                return Err(format!(
                    "Bulk write incomplete: wrote {} of {} bytes",
                    written,
                    chunk.len()
                ));
            }
            sent_bytes += chunk.len();
            emit_transfer_progress(None, sent_bytes, total_bytes);
        }
        Ok(())
    }

    fn bulk_write_with_progress(&mut self, bytes: &[u8], start: u8, end: u8) -> Result<(), String> {
        if let Some(libusb) = self.libusb.as_mut() {
            return libusb.bulk_write(bytes, Some((start, end)));
        }

        let total_bytes = bytes.len().max(1);
        let mut sent_bytes = 0usize;
        for chunk in bytes.chunks(BULK_WRITE_CHUNK_SIZE) {
            let mut written = 0u32;
            let interface = self
                .winusb
                .ok_or_else(|| "Bulk interface is not connected".to_string())?;
            unsafe {
                WinUsb_WritePipe(interface, BULK_OUT_ENDPOINT, chunk, Some(&mut written), None)
                    .map_err(|error| format!("Bulk write failed: {}", error.message()))?;
            }
            if written as usize != chunk.len() {
                return Err(format!(
                    "Bulk write incomplete: wrote {} of {} bytes",
                    written,
                    chunk.len()
                ));
            }
            sent_bytes += chunk.len();
            emit_transfer_progress(Some((start, end)), sent_bytes, total_bytes);
        }
        Ok(())
    }

    fn clear_hid(&mut self) {
        loop {
            match self.read_packet(1) {
                Ok(_) => {}
                Err(_) => break,
            }
        }
    }

    fn read_until(&mut self, prefixes: &[[u8; 2]], timeout_ms: u32) -> Result<Vec<u8>, String> {
        for _ in 0..MAX_READ_UNTIL_RETRIES {
            let packet = self.read_packet(timeout_ms)?;
            for view in packet_views(&packet) {
                if view.len() >= 2 {
                    let prefix = [view[0], view[1]];
                    if prefixes.contains(&prefix) {
                        return Ok(view.to_vec());
                    }
                }
            }
        }
        Err("Timed out waiting for expected HID response".to_string())
    }

    fn read_packet(&mut self, timeout_ms: u32) -> Result<Vec<u8>, String> {
        let event = OwnedHandle::event()?;
        let mut buffer = vec![0u8; self.hid_reports.input];
        let mut overlapped = OVERLAPPED::default();
        overlapped.hEvent = event.handle;

        let read_result = unsafe {
            ReadFile(
                self.hid_read_handle.handle,
                Some(buffer.as_mut_slice()),
                None,
                Some(&mut overlapped),
            )
        };
        let transferred = match read_result {
            Ok(()) => {
                let mut transferred = 0u32;
                unsafe {
                    GetOverlappedResultEx(
                        self.hid_read_handle.handle,
                        &overlapped,
                        &mut transferred,
                        timeout_ms,
                        false,
                    )
                    .map_err(|error| format!("HID read completion failed: {}", error.message()))?;
                }
                transferred
            }
            Err(_) => {
                let last_error = unsafe { GetLastError() };
                if last_error != ERROR_IO_PENDING {
                    return Err(format!("HID read failed: {}", last_error.0));
                }

                let mut transferred = 0u32;
                match unsafe {
                    GetOverlappedResultEx(
                        self.hid_read_handle.handle,
                        &overlapped,
                        &mut transferred,
                        timeout_ms,
                        false,
                    )
                } {
                    Ok(()) => transferred,
                    Err(_) => {
                        let _ = unsafe { CancelIoEx(self.hid_read_handle.handle, Some(&overlapped)) };
                        return Err("HID read timeout".to_string());
                    }
                }
            }
        };

        buffer.truncate(transferred as usize);
        if buffer.is_empty() {
            Err("HID read timeout".to_string())
        } else {
            trace_backend(&format!(
                "hid read {} bytes prefix={} {} {} {}",
                buffer.len(),
                buffer.first().copied().unwrap_or_default(),
                buffer.get(1).copied().unwrap_or_default(),
                buffer.get(2).copied().unwrap_or_default(),
                buffer.get(3).copied().unwrap_or_default()
            ));
            Ok(buffer)
        }
    }

    fn write_packet(&mut self, bytes: &[u8]) -> Result<(), String> {
        let mut errors = Vec::new();
        for packet in self.write_packet_candidates(bytes)? {
            match self.try_write_packet(&packet) {
                Ok(()) => return Ok(()),
                Err(error) => errors.push(error),
            }
        }

        Err(format!("HID write failed: {}", errors.join(" | ")))
    }

    fn write_packet_candidates(&self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        let mut candidates = Vec::new();
        let candidate_shapes = [
            (self.hid_reports.output.saturating_add(1), 1usize),
            (self.hid_reports.output, self.hid_reports.output_offset()),
            (self.hid_reports.output, 0usize),
            (HID_PACKET_LENGTH + 1, 1usize),
            (HID_PACKET_LENGTH, 0usize),
        ];

        for (packet_len, payload_offset) in candidate_shapes {
            if packet_len < payload_offset || bytes.len() > packet_len.saturating_sub(payload_offset) {
                continue;
            }

            let mut packet = vec![0u8; packet_len];
            packet[payload_offset..payload_offset + bytes.len()].copy_from_slice(bytes);
            if !candidates.iter().any(|existing| existing == &packet) {
                candidates.push(packet);
            }
        }

        if candidates.is_empty() {
            return Err(format!(
                "HID packet exceeds supported output report sizes ({} bytes command)",
                bytes.len()
            ));
        }

        Ok(candidates)
    }

    fn try_write_packet(&mut self, packet: &[u8]) -> Result<(), String> {
        match self.write_packet_sync(packet) {
            Ok(()) => Ok(()),
            Err(writefile_error) => {
                let ok = unsafe {
                    HidD_SetOutputReport(
                        self.hid_write_handle.handle,
                        packet.as_ptr() as *const _,
                        packet.len() as u32,
                    )
                };
                if ok {
                    Ok(())
                } else {
                    let last_error = unsafe { GetLastError() };
                    Err(format!(
                        "len={} err={} fallback={}",
                        packet.len(),
                        last_error.0,
                        writefile_error
                    ))
                }
            }
        }
    }

    fn write_packet_sync(&mut self, packet: &[u8]) -> Result<(), String> {
        let mut transferred = 0u32;
        unsafe {
            WriteFile(
                self.hid_write_handle.handle,
                Some(packet),
                Some(&mut transferred),
                None,
            )
            .map_err(|error| format!("WriteFile failed: {}", error.message()))?;
        }

        if transferred as usize != packet.len() {
            return Err(format!(
                "WriteFile wrote {} of {} bytes",
                transferred,
                packet.len()
            ));
        }

        Ok(())
    }
}

#[cfg(windows)]
fn open_control_device(supported_devices: &[SupportedDevice]) -> Result<KrakenDevice, String> {
    let (info, serial, hid_read_handle, hid_write_handle, hid_reports) =
        open_hid_device(supported_devices)?;
    let mut device = KrakenDevice {
        info,
        serial,
        hid_read_handle,
        hid_write_handle,
        hid_reports,
        libusb: None,
        bulk_handle: None,
        winusb: None,
    };
    device.initialize();
    Ok(device)
}

#[cfg(windows)]
fn open_transfer_device(supported_devices: &[SupportedDevice]) -> Result<KrakenDevice, String> {
    let mut device = open_control_device(supported_devices)?;
    match LibUsbDevice::open(device.info, &device.serial) {
        Ok(libusb) => {
            trace_backend("bulk transport selected: libusb");
            device.libusb = Some(libusb);
            return Ok(device);
        }
        Err(error) => trace_backend(&format!("libusb open failed: {}", error)),
    }

    let (bulk_handle, winusb) = open_bulk_device(device.info, &device.serial)?;
    trace_backend("bulk transport selected: winusb");
    device.bulk_handle = Some(bulk_handle);
    device.winusb = Some(winusb);
    Ok(device)
}

#[cfg(windows)]
fn open_hid_device(
    supported_devices: &[SupportedDevice],
) -> Result<(SupportedDevice, String, OwnedHandle, OwnedHandle, HidReportLengths), String> {
    let hid_guid = unsafe { HidD_GetHidGuid() };
    let paths = enumerate_interface_paths(&hid_guid)?;
    let mut fallback_candidate = None;

    for path in paths {
        let read_handle = match open_file_handle(&path, true) {
            Ok(handle) => handle,
            Err(_) => continue,
        };

        let mut attributes = HIDD_ATTRIBUTES {
            Size: size_of::<HIDD_ATTRIBUTES>() as u32,
            ..Default::default()
        };
        let hid_ok = unsafe { HidD_GetAttributes(read_handle.handle, &mut attributes) };
        if !hid_ok || attributes.VendorID != NZXT_VID {
            continue;
        }

        if let Some(info) = supported_devices.iter().copied().find(|device| device.pid == attributes.ProductID) {
            let write_handle = match open_file_handle(&path, false) {
                Ok(handle) => handle,
                Err(_) => continue,
            };
            let _ = unsafe { HidD_SetNumInputBuffers(read_handle.handle, 64) };
            let serial = read_hid_serial(read_handle.handle).unwrap_or_default();
            let hid_reports = query_hid_report_lengths(read_handle.handle)?;
            trace_backend(&format!(
                "hid candidate pid=0x{:04x} serial={} input={} output={} path={}",
                info.pid,
                if serial.is_empty() { "<none>" } else { &serial },
                hid_reports.input,
                hid_reports.output,
                path
            ));
            let candidate = (info, serial, read_handle, write_handle, hid_reports);
            if hid_reports.input <= HID_PACKET_LENGTH + 1 && hid_reports.output <= HID_PACKET_LENGTH + 1 {
                return Ok(candidate);
            }
            if fallback_candidate.is_none() {
                fallback_candidate = Some(candidate);
            }
        }
    }

    fallback_candidate
        .ok_or_else(|| "Could not connect to kraken device. Is NZXT CAM closed ?".to_string())
}

#[cfg(windows)]
fn open_bulk_device(info: SupportedDevice, serial: &str) -> Result<(OwnedHandle, WINUSB_INTERFACE_HANDLE), String> {
    let paths = enumerate_interface_paths(&USB_DEVICE_INTERFACE_GUID)?;
    let serial_upper = serial.to_ascii_uppercase();
    let pid_needle = format!("PID_{:04X}", info.pid);

    let mut preferred_paths = Vec::new();
    let mut fallback_paths = Vec::new();
    for path in paths {
        let upper_path = path.to_ascii_uppercase();
        if !upper_path.contains("VID_1E71") || !upper_path.contains(&pid_needle) {
            continue;
        }
        if !serial_upper.is_empty() && upper_path.contains(&serial_upper) {
            preferred_paths.push(path);
        } else {
            fallback_paths.push(path);
        }
    }

    for path in preferred_paths.into_iter().chain(fallback_paths.into_iter()) {
        trace_backend(&format!("bulk candidate path={}", path));
        let handle = match open_file_handle(&path, false) {
            Ok(handle) => handle,
            Err(_) => continue,
        };

        let mut interface = WINUSB_INTERFACE_HANDLE::default();
        let init_result = unsafe { WinUsb_Initialize(handle.handle, &mut interface) };
        if init_result.is_err() {
            continue;
        }

        if bulk_pipe_available(interface) {
            return Ok((handle, interface));
        }

        unsafe {
            let _ = windows::Win32::Devices::Usb::WinUsb_Free(interface);
        }
    }

    Err("Could not connect to kraken device. Is NZXT CAM closed ?".to_string())
}

#[cfg(windows)]
fn bulk_pipe_available(interface: WINUSB_INTERFACE_HANDLE) -> bool {
    for pipe_index in 0..16u8 {
        let mut pipe = WINUSB_PIPE_INFORMATION::default();
        let query = unsafe { WinUsb_QueryPipe(interface, 0, pipe_index, &mut pipe) };
        if query.is_err() {
            break;
        }
        if pipe.PipeType == UsbdPipeTypeBulk && pipe.PipeId == BULK_OUT_ENDPOINT {
            return true;
        }
    }
    false
}

#[cfg(windows)]
fn enumerate_interface_paths(guid: &GUID) -> Result<Vec<String>, String> {
    let device_info_set = unsafe {
        SetupDiGetClassDevsW(Some(guid), PCWSTR::null(), None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)
            .map_err(|error| format!("SetupDiGetClassDevsW failed: {}", error.message()))?
    };
    let device_info_set = DeviceInfoList { handle: device_info_set };

    let mut paths = Vec::new();
    for index in 0.. {
        let mut interface_data = SP_DEVICE_INTERFACE_DATA {
            cbSize: size_of::<SP_DEVICE_INTERFACE_DATA>() as u32,
            ..Default::default()
        };

        let enum_result = unsafe {
            SetupDiEnumDeviceInterfaces(
                device_info_set.handle,
                None,
                guid,
                index,
                &mut interface_data,
            )
        };

        if enum_result.is_err() {
            let error = unsafe { GetLastError() };
            if error == ERROR_NO_MORE_ITEMS {
                break;
            }
            return Err(format!("SetupDiEnumDeviceInterfaces failed: {}", error.0));
        }

        let mut required_size = 0u32;
        let _ = unsafe {
            SetupDiGetDeviceInterfaceDetailW(
                device_info_set.handle,
                &interface_data,
                None,
                0,
                Some(&mut required_size),
                None,
            )
        };

        if required_size == 0 {
            continue;
        }

        let mut buffer = vec![0u8; required_size as usize];
        let detail = buffer.as_mut_ptr() as *mut SP_DEVICE_INTERFACE_DETAIL_DATA_W;
        unsafe {
            (*detail).cbSize = size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;
        }

        unsafe {
            SetupDiGetDeviceInterfaceDetailW(
                device_info_set.handle,
                &interface_data,
                Some(detail),
                required_size,
                Some(&mut required_size),
                None,
            )
            .map_err(|error| format!("SetupDiGetDeviceInterfaceDetailW failed: {}", error.message()))?;
        }

        paths.push(read_wide_ptr(unsafe { (*detail).DevicePath.as_ptr() }));
    }

    Ok(paths)
}

#[cfg(windows)]
fn open_file_handle(path: &str, overlapped: bool) -> Result<OwnedHandle, String> {
    let wide_path = to_wide(path);
    let flags = if overlapped {
        FILE_FLAGS_AND_ATTRIBUTES(FILE_ATTRIBUTE_NORMAL.0 | FILE_FLAG_OVERLAPPED.0)
    } else {
        FILE_ATTRIBUTE_NORMAL
    };

    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide_path.as_ptr()),
            GENERIC_READ.0 | GENERIC_WRITE.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            flags,
            None,
        )
        .map_err(|error: windows::core::Error| error.message().to_string())?
    };

    Ok(OwnedHandle { handle })
}

#[cfg(windows)]
fn read_hid_serial(handle: HANDLE) -> Result<String, String> {
    let mut buffer = [0u16; 256];
    let ok = unsafe {
        HidD_GetSerialNumberString(
            handle,
            buffer.as_mut_ptr() as *mut _,
            (buffer.len() * size_of::<u16>()) as u32,
        )
    };

    if ok {
        Ok(read_wide_slice(&buffer))
    } else {
        Err("Could not read HID serial number".to_string())
    }
}

#[cfg(windows)]
fn query_hid_report_lengths(handle: HANDLE) -> Result<HidReportLengths, String> {
    let mut preparsed = std::mem::MaybeUninit::uninit();
    let got_preparsed = unsafe { HidD_GetPreparsedData(handle, preparsed.as_mut_ptr()) };
    if !got_preparsed {
        let last_error = unsafe { GetLastError() };
        return Err(format!("Could not query HID preparsed data: {}", last_error.0));
    }

    let preparsed = unsafe { preparsed.assume_init() };
    let mut caps = HIDP_CAPS::default();
    let status = unsafe { HidP_GetCaps(preparsed, &mut caps) };
    unsafe {
        let _ = HidD_FreePreparsedData(preparsed);
    }

    if status != HIDP_STATUS_SUCCESS {
        return Err(format!("Could not query HID report lengths: {:?}", status));
    }

    Ok(HidReportLengths::from_caps(caps))
}

#[cfg(windows)]
fn claim_libusb_interface(
    api: &LibUsbApi,
    device_handle: *mut LibUsbDeviceHandleOpaque,
) -> Result<(i32, i32), String> {
    for (interface, alt_setting) in libusb_bulk_interface_candidates(api, device_handle)? {
        let result = unsafe { (api.claim_interface)(device_handle, interface) };
        trace_backend(&format!(
            "libusb claim interface {} alt {} -> {}",
            interface, alt_setting, result
        ));
        if result == 0 {
            if alt_setting != 0 {
                let alt_result =
                    unsafe { (api.set_interface_alt_setting)(device_handle, interface, alt_setting) };
                trace_backend(&format!(
                    "libusb set alt setting {} on interface {} -> {}",
                    alt_setting, interface, alt_result
                ));
                if alt_result != 0 {
                    let _ = unsafe { (api.release_interface)(device_handle, interface) };
                    continue;
                }
            }
            return Ok((interface, alt_setting));
        }
    }

    Err("libusb could not claim a bulk interface".to_string())
}

#[cfg(windows)]
fn libusb_bulk_interface_candidates(
    api: &LibUsbApi,
    device_handle: *mut LibUsbDeviceHandleOpaque,
) -> Result<Vec<(i32, i32)>, String> {
    let mut candidates = Vec::new();
    let device = unsafe { (api.get_device)(device_handle) };
    if device.is_null() {
        return Err("libusb could not resolve device for interface enumeration".to_string());
    }

    let mut config = std::ptr::null();
    let config_result = unsafe { (api.get_active_config_descriptor)(device, &mut config) };
    if config_result != 0 {
        trace_backend(&format!(
            "libusb active config descriptor unavailable: {}",
            config_result
        ));
        return Ok(vec![(1, 0), (0, 0), (2, 0), (3, 0)]);
    }

    unsafe {
        let config_ref = &*config;
        for interface_index in 0..config_ref.bNumInterfaces as usize {
            let interface = &*config_ref.interface.add(interface_index);
            for alt_index in 0..interface.num_altsetting as usize {
                let descriptor = &*interface.altsetting.add(alt_index);
                for endpoint_index in 0..descriptor.bNumEndpoints as usize {
                    let endpoint = &*descriptor.endpoint.add(endpoint_index);
                    trace_backend(&format!(
                        "libusb endpoint iface={} alt={} ep=0x{:02x} attr=0x{:02x}",
                        descriptor.bInterfaceNumber,
                        descriptor.bAlternateSetting,
                        endpoint.bEndpointAddress,
                        endpoint.bmAttributes
                    ));
                    if endpoint.bEndpointAddress == BULK_OUT_ENDPOINT
                        && (endpoint.bmAttributes & 0x03) == 0x02
                    {
                        candidates.push((
                            descriptor.bInterfaceNumber as i32,
                            descriptor.bAlternateSetting as i32,
                        ));
                    }
                }
            }
        }
        (api.free_config_descriptor)(config);
    }

    if candidates.is_empty() {
        Ok(vec![(1, 0), (0, 0), (2, 0), (3, 0)])
    } else {
        candidates.sort_unstable();
        candidates.dedup();
        Ok(candidates)
    }
}

#[cfg(windows)]
unsafe fn read_libusb_serial(
    api: &LibUsbApi,
    device_handle: *mut LibUsbDeviceHandleOpaque,
) -> Result<String, String> {
    let device = (api.get_device)(device_handle);
    if device.is_null() {
        return Err("libusb could not resolve device".to_string());
    }

    let mut descriptor = LibUsbDeviceDescriptor::default();
    let descriptor_result = (api.get_device_descriptor)(device, &mut descriptor);
    if descriptor_result != 0 {
        return Err(format!(
            "libusb could not query device descriptor: {}",
            descriptor_result
        ));
    }
    if descriptor.iSerialNumber == 0 {
        return Err("libusb device has no serial descriptor".to_string());
    }

    let mut buffer = [0u8; 256];
    let length = (api.get_string_descriptor_ascii)(
        device_handle,
        descriptor.iSerialNumber,
        buffer.as_mut_ptr(),
        buffer.len() as i32,
    );
    if length < 0 {
        return Err(format!("libusb could not read serial string: {}", length));
    }

    Ok(String::from_utf8_lossy(&buffer[..length as usize]).to_string())
}

#[cfg(windows)]
unsafe fn load_libusb_symbol<T: Copy>(module: HMODULE, name: &'static [u8]) -> Result<T, String> {
    let symbol = GetProcAddress(module, PCSTR(name.as_ptr()));
    if symbol.is_none() {
        return Err(format!(
            "Could not load libusb symbol {}",
            String::from_utf8_lossy(&name[..name.len().saturating_sub(1)])
        ));
    }

    Ok(std::mem::transmute_copy::<FARPROC, T>(&symbol))
}

#[cfg(windows)]
fn parse_standard_result(packet: &[u8], message: &str) -> Result<(), String> {
    if packet_status(packet) == 1 {
        Ok(())
    } else {
        Err(format!("{} (status {})", message, packet_status(packet)))
    }
}

#[cfg(windows)]
fn packet_status(packet: &[u8]) -> u8 {
    packet.get(14).copied().unwrap_or_default()
}

#[cfg(windows)]
fn packet_views(packet: &[u8]) -> [&[u8]; 2] {
    let shifted = if packet.len() > 1 { &packet[1..] } else { &[] };
    [packet, shifted]
}

#[cfg(windows)]
fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(iter::once(0)).collect()
}

#[cfg(windows)]
fn read_wide_ptr(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }

    let mut len = 0usize;
    unsafe {
        while *ptr.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(slice::from_raw_parts(ptr, len))
    }
}

#[cfg(windows)]
fn read_wide_slice(buffer: &[u16]) -> String {
    let len = buffer.iter().position(|value| *value == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len])
}

fn escape_for_json(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn trace_backend(message: &str) {
    if std::env::var("KRAKEN_BACKEND_TRACE").ok().as_deref() == Some("1") {
        eprintln!("[backend-rust] {}", message);
    }
}

fn format_message_json(message: &str) -> String {
    format!("{{\"message\":\"{}\"}}", escape_for_json(message))
}

#[cfg(windows)]
fn export_prepared_gif(source_path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let app_root = std::env::var("KRAKEN_APP_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let export_dir = app_root.join(".electron-data").join("prepared-gifs");
    fs::create_dir_all(&export_dir)
        .map_err(|error| format!("Could not create prepared GIF export folder: {}", error))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let base_name = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_file_stem)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "prepared".to_string());
    let file_name = format!("{}-{}-rust-prepared.gif", timestamp, base_name);
    let export_path = export_dir.join(file_name);

    fs::write(&export_path, bytes)
        .map_err(|error| format!("Could not export prepared GIF: {}", error))?;
    Ok(export_path)
}

#[cfg(windows)]
fn sanitize_file_stem(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut last_dash = false;

    for ch in input.chars() {
        let normalized = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if normalized == '-' {
            if !last_dash {
                output.push('-');
                last_dash = true;
            }
        } else {
            output.push(normalized);
            last_dash = false;
        }
    }

    output.trim_matches('-').to_string()
}

fn format_device_info_json(device: SupportedDevice) -> String {
    format!(
        "{{\"name\":\"{}\",\"pid\":{},\"pidHex\":\"0x{:04x}\",\"resolution\":{{\"width\":{},\"height\":{}}},\"message\":\"Kraken detected\"}}",
        escape_for_json(device.name),
        device.pid,
        device.pid,
        device.width,
        device.height
    )
}

#[cfg(windows)]
fn emit_progress(value: u8, message: &str) {
    let payload = format!(
        "{{\"type\":\"progress\",\"value\":{},\"message\":\"{}\"}}",
        value.min(100),
        escape_for_json(message)
    );
    let mut stdout = io::stdout();
    let _ = writeln!(stdout, "{}", payload);
    let _ = stdout.flush();
}

#[cfg(windows)]
fn emit_transfer_progress(progress_range: Option<(u8, u8)>, sent_bytes: usize, total_bytes: usize) {
    let Some((start, end)) = progress_range else {
        return;
    };

    let ratio = (sent_bytes as f32 / total_bytes.max(1) as f32).clamp(0.0, 1.0);
    let value = start as f32 + (end.saturating_sub(start)) as f32 * ratio;
    emit_progress(value.round() as u8, "Transferring GIF data...");
}

#[cfg(windows)]
struct OwnedHandle {
    handle: HANDLE,
}

#[cfg(windows)]
impl OwnedHandle {
    fn event() -> Result<Self, String> {
        let handle = unsafe {
            CreateEventW(None, true, false, PCWSTR::null())
                .map_err(|error: windows::core::Error| format!("Could not create event handle: {}", error.message()))?
        };
        Ok(Self { handle })
    }
}

#[cfg(windows)]
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.handle) };
    }
}

#[cfg(windows)]
struct DeviceInfoList {
    handle: HDEVINFO,
}

#[cfg(windows)]
impl Drop for DeviceInfoList {
    fn drop(&mut self) {
        let _ = unsafe { SetupDiDestroyDeviceInfoList(self.handle) };
    }
}
