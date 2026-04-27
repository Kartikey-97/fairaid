import pandas as pd
from fastapi import APIRouter, File, UploadFile, HTTPException, Depends
from backend.core.db import storage
from backend.api.routes.platform import require_session
import io

router = APIRouter()

@router.post("/upload")
async def upload_survey_csv(
    file: UploadFile = File(...),
    # Require session to ensure only authenticated users can upload surveys
    user_id: str = Depends(require_session)
):
    filename = file.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    try:
        contents = await file.read()
        df = pd.read_csv(io.BytesIO(contents))
        
        # We expect a certain structure. For example:
        # title, description, lat, lng, emergency_level, urgency, impact_level
        processed_count = 0
        
        # Basic validation of expected columns
        expected_cols = {"title", "lat", "lng"}
        if not expected_cols.issubset(set(df.columns)):
            raise HTTPException(
                status_code=400, 
                detail=f"CSV is missing required columns. Expected at least: {', '.join(expected_cols)}"
            )

        for _, row in df.iterrows():
            payload = {
                "ngo_id": user_id,
                "ngo_name": "Field Survey Team", # Default name or could fetch from user
                "title": str(row["title"]),
                "description": str(row.get("description", "Survey reported need")),
                "need_type": str(row.get("need_type", "general-support")),
                "emergency_level": "emergency" if str(row.get("emergency_level", "")).lower() == "emergency" else "non_emergency",
                "urgency": int(row.get("urgency", 5)),
                "impact_level": int(row.get("impact_level", 5)),
                "required_volunteers": int(row.get("required_volunteers", 1)),
                "location": {
                    "lat": float(row["lat"]),
                    "lng": float(row["lng"])
                },
                "contact": {
                    "name": "Field Operator",
                }
            }
            
            # Use existing creation method to ensure it gets embeddings and audit logs
            storage.create_need(payload)
            processed_count += 1
            
        return {"status": "success", "processed_count": processed_count}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
