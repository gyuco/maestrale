"""Visualizzatore legacy, non usato dalla pipeline FastAPI.

Visualizza i dati mare scaricati da sardegna_mare.py per una località.

Uso:
    python visualizza_mare.py                 # elenco località disponibili
    python visualizza_mare.py Cagliari        # grafico per Cagliari
    python visualizza_mare.py --lista         # elenco località
    python visualizza_mare.py Cagliari --salva grafico.png   # salva su file

Per ogni località estrae il punto di griglia più vicino (in mare) e mostra:
  - temperatura superficiale (°C)
  - altezza significativa delle onde (m)
  - periodo medio delle onde (s)
  - velocità della corrente superficiale (m/s)
"""

import argparse
import sys

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import xarray as xr

FILE_TEMPERATURA = "sardegna_temperatura.nc"
FILE_CORRENTI = "sardegna_correnti.nc"
FILE_ONDE = "sardegna_onde.nc"

# Nome -> (latitudine, longitudine) di un punto in mare vicino alla località.
LOCALITA = {
    "Alghero": (40.56, 8.26),
    "Arbatax": (39.92, 9.72),
    "Cagliari": (39.17, 9.15),
    "Carloforte": (39.10, 8.28),
    "Chia": (38.87, 8.84),
    "La Maddalena": (41.22, 9.40),
    "Olbia": (40.92, 9.58),
    "Oristano": (39.87, 8.45),
    "Porto Torres": (40.87, 8.37),
    "Santa Teresa Gallura": (41.24, 9.18),
    "Siniscola": (40.60, 9.78),
    "Torre dei Corsari": (39.70, 8.40),
    "Villasimius": (39.10, 9.52),
}


def carica_dataset():
    """Carica i tre dataset .nc. Esce con un messaggio se mancano."""
    try:
        temperatura = xr.open_dataset(FILE_TEMPERATURA)
        correnti = xr.open_dataset(FILE_CORRENTI)
        onde = xr.open_dataset(FILE_ONDE)
    except FileNotFoundError as e:
        sys.exit(
            f"File .nc non trovato: {e.filename}\n"
            "Esegui prima: python sardegna_mare.py"
        )
    return temperatura, correnti, onde


def trova_punto(data: xr.DataArray, lat: float, lon: float):
    """
    Trova il punto di griglia più vicino a (lat, lon) che abbia almeno
    un valore valido (non NaN) nel tempo. Restituisce (lat, lon, serie).
    """
    lat2d, lon2d = np.meshgrid(
        data.latitude.values, data.longitude.values, indexing="ij"
    )
    dist = np.hypot(lat2d - lat, lon2d - lon)
    nlon = data.longitude.size
    for k in np.argsort(dist.ravel()):
        i, j = divmod(int(k), nlon)
        serie = data.isel(latitude=i, longitude=j)
        if bool(serie.notnull().any()):
            return (
                float(data.latitude.values[i]),
                float(data.longitude.values[j]),
                serie,
            )
    raise ValueError(f"Nessun punto con dati vicino a ({lat}, {lon})")


def direzione_media(uo: xr.DataArray, vo: xr.DataArray) -> float:
    """Direzione media della corrente in gradi da N (verso cui va)."""
    return float(np.degrees(np.arctan2(float(uo.mean()), float(vo.mean()))) % 360)


def plot_localita(nome: str, lat: float, lon: float, salva: str | None = None):
    temperatura, correnti, onde = carica_dataset()

    _, _, thetao = trova_punto(temperatura["thetao"], lat, lon)
    _, _, uo = trova_punto(correnti["uo"], lat, lon)
    _, _, vo = trova_punto(correnti["vo"], lat, lon)
    lat_pt, lon_pt, vhm0 = trova_punto(onde["VHM0"], lat, lon)
    _, _, vtm10 = trova_punto(onde["VTM10"], lat_pt, lon_pt)
    _, _, vmdr = trova_punto(onde["VMDR"], lat_pt, lon_pt)

    velocita = np.hypot(uo, vo)
    dir_corrente = direzione_media(uo, vo)
    dir_onde = float(vmdr.mean())  # direzione da cui provengono le onde (convenzione N)

    tempo = thetao.time.values

    fig, axes = plt.subplots(2, 2, figsize=(11, 8), sharex=True)
    fig.suptitle(
        f"{nome} — punto mare ({lat_pt:.2f}°N, {lon_pt:.2f}°E)\n"
        f"previsione {np.datetime_as_string(tempo[0], unit='D')} → "
        f"{np.datetime_as_string(tempo[-1], unit='D')}",
        fontsize=13,
    )

    ax = axes[0, 0]
    ax.plot(tempo, thetao, color="tab:red", lw=2)
    ax.set_ylabel("Temperatura superficiale (°C)")
    ax.set_title("Temperatura del mare")
    ax.grid(alpha=0.3)

    ax = axes[0, 1]
    ax.plot(tempo, vhm0, color="tab:blue", lw=2)
    ax.set_ylabel("Altezza significativa (m)")
    ax.set_title(f"Onde — dir. media {dir_onde:.0f}°N")
    ax.grid(alpha=0.3)

    ax = axes[1, 0]
    ax.plot(tempo, vtm10, color="tab:cyan", lw=2)
    ax.set_ylabel("Periodo medio (s)")
    ax.set_title("Periodo delle onde")
    ax.grid(alpha=0.3)

    ax = axes[1, 1]
    ax.plot(tempo, velocita, color="tab:green", lw=2)
    ax.set_ylabel("Velocità (m/s)")
    ax.set_title(f"Corrente superficiale — dir. media {dir_corrente:.0f}°N")
    ax.grid(alpha=0.3)

    for ax in axes.flat:
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %H:%M"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()

    print(f"\n=== {nome} ({lat_pt:.2f}°N, {lon_pt:.2f}°E) ===")
    print(f"Temperatura:  min {float(thetao.min()):.1f} °C | "
          f"max {float(thetao.max()):.1f} °C")
    print(f"Onde:         max {float(vhm0.max()):.2f} m | "
          f"periodo medio {float(vtm10.mean()):.1f} s")
    print(f"Corrente:     max {float(velocita.max()):.2f} m/s | "
          f"dir. media {dir_corrente:.0f}°N")

    if salva:
        fig.savefig(salva, dpi=150, bbox_inches="tight")
        print(f"Grafico salvato in: {salva}")
    else:
        plt.show()


def stampa_localita():
    print("Località disponibili (lat, lon del punto in mare):")
    for nome, (lat, lon) in LOCALITA.items():
        print(f"  {nome:<22} {lat:.2f}°N  {lon:.2f}°E")


def main():
    parser = argparse.ArgumentParser(
        description="Visualizza i dati mare per località."
    )
    parser.add_argument(
        "localita",
        nargs="?",
        help="Nome della località (vedi --lista).",
    )
    parser.add_argument("--lista", action="store_true", help="Elenco località.")
    parser.add_argument("--salva", metavar="FILE", help="Salva il grafico su FILE.")
    args = parser.parse_args()

    if args.lista or not args.localita:
        stampa_localita()
        if not args.localita:
            print("\nEsempio: python visualizza_mare.py Cagliari")
        return

    nome = args.localita
    if nome not in LOCALITA:
        stampa_localita()
        sys.exit(f"\nLocalità '{nome}' sconosciuta. Scegline una dalla lista.")

    lat, lon = LOCALITA[nome]
    plot_localita(nome, lat, lon, salva=args.salva)


if __name__ == "__main__":
    main()
