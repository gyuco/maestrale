"""Prototipo legacy, non usato dalla pipeline FastAPI.

Situazione del mare - Sardegna
Scarica temperatura/correnti (fisica) e altezza onde da Copernicus Marine Service.

AUTENTICAZIONE (no token/API key, solo username+password). Tre modi:

1) CONSIGLIATO - variabili d'ambiente lette da file .env (mai nel codice):
   pip install python-dotenv
   Crea un file ".env" nella stessa cartella con:
       COPERNICUSMARINE_SERVICE_USERNAME=tuo_username
       COPERNICUSMARINE_SERVICE_PASSWORD=tua_password
   Il toolbox legge queste env var automaticamente in get()/subset().

2) Login una tantum salvato su disco (~/.copernicusmarine-credentials):
   python -c "import copernicusmarine; copernicusmarine.login()"
   Da quel momento non serve più passare nulla.

3) Passare username/password direttamente alle funzioni subset()/get()
   (sconsigliato se il codice finisce su git: rischio di leakare le credenziali).
"""

import os
from dotenv import load_dotenv
import copernicusmarine

# Carica username/password dal file .env nella variabile d'ambiente.
# override=True: il file .env ha la precedenza su eventuali variabili
# d'ambiente già presenti (es. vecchi valori esportati nella shell).
load_dotenv(override=True)
USERNAME = os.getenv("COPERNICUSMARINE_SERVICE_USERNAME")
PASSWORD = os.getenv("COPERNICUSMARINE_SERVICE_PASSWORD")
if not USERNAME or not PASSWORD:
    raise SystemExit(
        "Credenziali mancanti. Crea un file .env con "
        "COPERNICUSMARINE_SERVICE_USERNAME e COPERNICUSMARINE_SERVICE_PASSWORD."
    )

# ---- Bounding box intorno alla Sardegna ----
LON_MIN, LON_MAX = 7.5, 10.5
LAT_MIN, LAT_MAX = 38.5, 41.5

# ---- Intervallo temporale (oggi + domani, dati forecast) ----
START = "2026-08-13T00:00:00"
END = "2026-08-14T00:00:00"


def scarica_fisica_mare():
    """Temperatura superficiale del mare - Mediterraneo."""
    copernicusmarine.subset(
        dataset_id="cmems_mod_med_phy-tem_anfc_4.2km-2D_PT1H-m",  # temperatura superficiale, oraria
        variables=["thetao"],  # temperatura potenziale del mare
        minimum_longitude=LON_MIN,
        maximum_longitude=LON_MAX,
        minimum_latitude=LAT_MIN,
        maximum_latitude=LAT_MAX,
        start_datetime=START,
        end_datetime=END,
        output_filename="sardegna_temperatura.nc",
        output_directory=".",
        username=USERNAME,
        password=PASSWORD,
    )


def scarica_correnti_mare():
    """Correnti superficiali (componenti U/V)."""
    copernicusmarine.subset(
        dataset_id="cmems_mod_med_phy-cur_anfc_4.2km-2D_PT1H-m",  # correnti superficiali, orarie
        variables=["uo", "vo"],  # componenti est-ovest / nord-sud della corrente
        minimum_longitude=LON_MIN,
        maximum_longitude=LON_MAX,
        minimum_latitude=LAT_MIN,
        maximum_latitude=LAT_MAX,
        start_datetime=START,
        end_datetime=END,
        output_filename="sardegna_correnti.nc",
        output_directory=".",
        username=USERNAME,
        password=PASSWORD,
    )


def scarica_onde():
    """Altezza, periodo e direzione delle onde."""
    copernicusmarine.subset(
        dataset_id="cmems_mod_med_wav_anfc_4.2km_PT1H-i",  # onde, Mediterranean Waves Analysis/Forecast
        variables=["VHM0", "VTM10", "VMDR"],  # altezza sign., periodo medio, direzione media
        minimum_longitude=LON_MIN,
        maximum_longitude=LON_MAX,
        minimum_latitude=LAT_MIN,
        maximum_latitude=LAT_MAX,
        start_datetime=START,
        end_datetime=END,
        output_filename="sardegna_onde.nc",
        output_directory=".",
        username=USERNAME,
        password=PASSWORD,
    )


if __name__ == "__main__":
    print("Scarico dati temperatura/salinità...")
    scarica_fisica_mare()

    print("Scarico dati correnti...")
    scarica_correnti_mare()

    print("Scarico dati onde...")
    scarica_onde()

    print("Fatto! File .nc salvati nella cartella corrente.")
    print("Apri con xarray: import xarray as xr; ds = xr.open_dataset('sardegna_onde.nc')")
