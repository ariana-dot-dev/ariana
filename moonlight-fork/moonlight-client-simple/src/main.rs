use std::time::Duration;

use moonlight_common::{
    PairPin, PairStatus,
    network::backend::reqwest::ReqwestMoonlightHost,
    pair::{ClientAuth, generate_new_client},
    stream::{
        MoonlightInstance,
        bindings::{ActiveGamepads, ColorRange, Colorspace, EncryptionFlags},
        debug::DebugHandler,
    },
};

use simplelog::{ColorChoice, LevelFilter, TermLogger, TerminalMode};
use tokio::{
    fs::{self, File, read_to_string, try_exists, write},
    io::AsyncWriteExt,
    task::spawn_blocking,
    time::sleep,
};

use crate::gstreamer::gstreamer_pipeline;

mod gstreamer;

#[tokio::main]
async fn main() {
    TermLogger::init(
        LevelFilter::Debug,
        simplelog::Config::default(),
        TerminalMode::Mixed,
        ColorChoice::Auto,
    )
    .expect("failed to init logger");

    // Configuration
    let host_ip = "127.0.0.1";
    let host_http_port = 47989;
    let device_name = "TestDevice";

    // Configuration Authentication / Pairing
    let key_file = "client.key";
    let crt_file = "client.crt";
    let server_crt_file = "server.crt";

    // Initialize Moonlight
    let moonlight = MoonlightInstance::global().unwrap();

    // Create a host
    // - client_info = None -> Generates a client
    let mut host = ReqwestMoonlightHost::new(host_ip.to_string(), host_http_port, None).unwrap();

    // Pair to the Host using Generated / Loaded Client Private Key, Certificate and Server Certificate
    if let Ok(true) = try_exists(key_file).await
        && let Ok(true) = try_exists(crt_file).await
        && let Ok(true) = try_exists(server_crt_file).await
    {
        // Load already valid pairing information
        let key_contents = read_to_string(key_file).await.unwrap();
        let crt_contents = read_to_string(crt_file).await.unwrap();
        let server_crt_contents = read_to_string(server_crt_file).await.unwrap();

        let client_private_key = pem::parse(key_contents).unwrap();
        let client_certificate = pem::parse(crt_contents).unwrap();
        let server_certificate = pem::parse(server_crt_contents).unwrap();

        // Get the current pair state
        host.set_pairing_info(
            &ClientAuth {
                private_key: client_private_key,
                certificate: client_certificate,
            },
            &server_certificate,
        )
        .unwrap();

        assert_eq!(host.verify_paired().await.unwrap(), PairStatus::Paired);
    } else {
        // Generate new client
        let auth = generate_new_client().unwrap();

        // Generate pin for pairing
        let pin = PairPin::generate().unwrap();

        println!("Pin: {pin}, Device Name: {device_name}");

        // Pair to the host
        host.pair(&auth, device_name.to_string(), pin)
            .await
            .unwrap();

        let Some(client_certificate) = host.client_certificate() else {
            panic!("failed to get client certificate on paired host");
        };
        let Some(client_private_key) = host.client_private_key() else {
            panic!("failed to get client private keyon paired host");
        };
        let Some(server_certificate) = host.server_certificate() else {
            panic!("failed to get server certificate on paired host");
        };

        // Save the pair information
        write(key_file, client_private_key.to_string())
            .await
            .unwrap();
        write(crt_file, client_certificate.to_string())
            .await
            .unwrap();
        write(server_crt_file, server_certificate.to_string())
            .await
            .unwrap();
    };

    let apps = host.app_list().await.unwrap().to_vec();

    println!("Writing all app images to file");

    fs::create_dir_all("appimages").await.unwrap();

    println!("The host has {} apps:", apps.len());
    for app in &apps {
        println!("- {app:?}");

        let app_image = host.request_app_image(app.id).await.unwrap();

        File::create(format!("appimages/{}.png", app.id))
            .await
            .unwrap()
            .write_all(&app_image)
            .await
            .unwrap();
    }

    assert!(!apps.is_empty(), "The host needs at least one app!");

    let app = &apps[0];
    let app_id = app.id;

    println!("Connecting to the first app: {app:?}");

    // Creating gstreamer stuff
    gstreamer::init();

    let (video_decoder, audio_decoder) = gstreamer_pipeline().unwrap();

    // Start the stream (only 1 stream per program is allowed)
    let stream = host
        .start_stream(
            &moonlight,
            app_id,
            1920,
            1080,
            60,
            false,
            false,
            false,
            ActiveGamepads::empty(),
            false,
            Colorspace::Rec2020,
            ColorRange::Full,
            4000,
            1024,
            EncryptionFlags::all(),
            DebugHandler,
            video_decoder,
            audio_decoder,
        )
        .await
        .unwrap();
    println!("Finished Connection");

    sleep(Duration::from_secs(60)).await;

    println!("Closing Connection");

    // Stop the stream (drop will also just close the stream)
    spawn_blocking(move || {
        stream.stop();
    })
    .await
    .unwrap();
    drop(host);

    sleep(Duration::from_secs(2)).await;
}
