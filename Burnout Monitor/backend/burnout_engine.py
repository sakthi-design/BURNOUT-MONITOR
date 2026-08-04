from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any
import joblib
import numpy as np
from .config import MODEL_PATH

# Load model pipeline on startup
_model = None

def init_model() -> None:
    global _model
    try:
        if not MODEL_PATH.exists():
            from backend.train_model import train_and_evaluate
            train_and_evaluate()
        _model = joblib.load(MODEL_PATH)
    except Exception:
        try:
            from backend.train_model import train_and_evaluate
            train_and_evaluate()
            _model = joblib.load(MODEL_PATH)
        except Exception:
            _model = None


# Load on import
init_model()


POSITIVE_WORDS = {
    "balanced",
    "manageable",
    "improved",
    "support",
    "helpful",
    "steady",
    "clear",
    "enough",
    "recharge",
    "collaboration",
    "exciting",
}

NEGATIVE_WORDS = {
    "overwhelmed",
    "exhausted",
    "tired",
    "intense",
    "pressure",
    "stressful",
    "anxiety",
    "disconnect",
    "drained",
    "severe",
    "escalations",
    "deadlines",
    "heavy",
}


def clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return max(minimum, min(maximum, value))


def normalize(value: float, maximum: float) -> float:
    return clamp((value / maximum) * 100)


@dataclass
class SentimentResult:
    positive: int
    negative: int
    label: str


@dataclass
class Driver:
    name: str
    normalized: int
    weighted: float


@dataclass
class PredictionResult:
    score: int
    risk: str
    sentiment: SentimentResult
    top_driver: Driver
    drivers: list[Driver]
    recommendations: list[dict[str, str]]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["top_driver"] = asdict(self.top_driver)
        payload["sentiment"] = asdict(self.sentiment)
        payload["drivers"] = [asdict(driver) for driver in self.drivers]
        payload["recommendations"] = [[r["title"], r["description"]] for r in self.recommendations]
        return payload


def analyze_sentiment(text: str = "") -> SentimentResult:
    words = [
        "".join(character for character in word.lower() if character.isalpha())
        for word in text.split()
    ]
    words = [word for word in words if word]
    if not words:
        return SentimentResult(positive=50, negative=50, label="Neutral")

    positives = sum(word in POSITIVE_WORDS for word in words)
    negatives = sum(word in NEGATIVE_WORDS for word in words)
    negative = round(clamp(50 + negatives * 14 - positives * 10))
    positive = 100 - negative

    if negative >= 65:
        label = "Negative"
    elif negative <= 38:
        label = "Positive"
    else:
        label = "Neutral"

    return SentimentResult(positive=positive, negative=negative, label=label)


def risk_level(score: float) -> str:
    if score <= 30:
        return "Low"
    if score <= 60:
        return "Medium"
    if score <= 80:
        return "High"
    return "Critical"


def build_drivers(metrics: dict[str, Any], sentiment: SentimentResult) -> list[Driver]:
    # Default weights from original heuristic
    w_work, w_overtime, w_task, w_meeting, w_sentiment = 0.25, 0.20, 0.20, 0.15, 0.20
    
    if _model is not None:
        try:
            # Try to get feature importances from classifier to weight drivers
            importances = _model.named_steps["classifier"].feature_importances_
            w_work = importances[0]
            w_overtime = importances[1]
            w_task = importances[3]
            w_meeting = importances[5]
            w_sentiment = importances[8]
            
            # Normalize importances so they sum to 1.0 (matching sum of heuristic weights)
            total = w_work + w_overtime + w_task + w_meeting + w_sentiment
            if total > 0:
                w_work /= total
                w_overtime /= total
                w_task /= total
                w_meeting /= total
                w_sentiment /= total
        except Exception:
            pass

    definitions = [
        ("Work hours", normalize(metrics.get("work_hours", 0), 12), w_work),
        ("Overtime", normalize(metrics.get("overtime_hours", 0), 5), w_overtime),
        ("Task load", clamp(metrics.get("task_load", 0)), w_task),
        ("Meeting hours", normalize(metrics.get("meeting_hours", 0), 24), w_meeting),
        ("Negative sentiment", sentiment.negative, w_sentiment),
    ]
    return [
        Driver(name=name, normalized=round(normalized), weighted=normalized * weight)
        for name, normalized, weight in definitions
    ]


def build_recommendations(metrics: dict[str, Any], score: float, risk: str, sentiment: SentimentResult) -> list[dict[str, str]]:
    recommendations: list[dict[str, str]] = []

    if risk in {"High", "Critical"}:
        recommendations.append(
            {
                "title": "Manager check-in",
                "description": "Schedule a private workload review within 24 hours.",
            }
        )
        recommendations.append(
            {
                "title": "Workload rebalance",
                "description": "Move urgent but non-critical tasks to another team member.",
            }
        )

    if float(metrics.get("overtime_hours", 0)) >= 2 or float(metrics.get("work_hours", 0)) >= 9.5:
        recommendations.append(
            {
                "title": "Overtime control",
                "description": "Cap overtime for the next sprint and protect recovery time.",
            }
        )

    if float(metrics.get("meeting_hours", 0)) >= 14:
        recommendations.append(
            {
                "title": "Meeting audit",
                "description": "Cancel low-value recurring meetings and create focus blocks.",
            }
        )

    if sentiment.negative >= 65 or float(metrics.get("stress_level", 50)) >= 75:
        recommendations.append(
            {
                "title": "Wellness support",
                "description": "Offer counseling, wellness session, or mental health resources.",
            }
        )

    if float(metrics.get("leave_days", 0)) <= 1:
        recommendations.append(
            {
                "title": "Time off",
                "description": "Encourage leave or a flexible schedule before stress becomes chronic.",
            }
        )

    if not recommendations:
        recommendations.append(
            {
                "title": "Maintain rhythm",
                "description": "Keep current workload levels and continue monthly check-ins.",
            }
        )
        recommendations.append(
            {
                "title": "Recognition",
                "description": "Share positive feedback to reinforce healthy team behavior.",
            }
        )

    return recommendations[:4]


def predict_burnout(metrics: dict[str, Any]) -> PredictionResult:
    sentiment = analyze_sentiment(metrics.get("feedback", ""))
    
    score = None
    risk = None
    
    if _model is not None:
        try:
            # Construct feature vector matching train_model.py
            # FEATURE_NAMES: work_hours, overtime_hours, leave_days, task_load, completion_rate, meeting_hours, job_satisfaction, stress_level, sentiment_score
            X_feat = np.array([[
                float(metrics.get("work_hours", 8.0) if metrics.get("work_hours") is not None else 8.0),
                float(metrics.get("overtime_hours", 0.0) if metrics.get("overtime_hours") is not None else 0.0),
                float(metrics.get("leave_days", 2.0) if metrics.get("leave_days") is not None else 2.0),
                float(metrics.get("task_load", 50.0) if metrics.get("task_load") is not None else 50.0),
                float(metrics.get("completion_rate", 75.0) if metrics.get("completion_rate") is not None else 75.0),
                float(metrics.get("meeting_hours", 5.0) if metrics.get("meeting_hours") is not None else 5.0),
                float(metrics.get("job_satisfaction", 60.0) if metrics.get("job_satisfaction") is not None else 60.0),
                float(metrics.get("stress_level", 40.0) if metrics.get("stress_level") is not None else 40.0),
                float(sentiment.positive)  # sentiment_score maps to positive sentiment
            ]])
            
            # Predict probabilities
            probabilities = _model.predict_proba(X_feat)[0]
            class_prob = dict(zip(_model.classes_, probabilities))
            
            p_low = class_prob.get("Low", 0.0)
            p_medium = class_prob.get("Medium", 0.0)
            p_high = class_prob.get("High", 0.0)
            p_critical = class_prob.get("Critical", 0.0)
            
            # Calculate continuous score expectation
            score = p_low * 15.0 + p_medium * 45.0 + p_high * 75.0 + p_critical * 95.0
            score = clamp(score)
            
            # Predict the class directly using classifier output
            risk = _model.predict(X_feat)[0]
        except Exception:
            score = None
            risk = None
            
    if score is None or risk is None:
        # Fallback to baseline heuristic
        drivers = build_drivers(metrics, sentiment)
        base_score = sum(driver.weighted for driver in drivers)
        stress_adjustment = (clamp(metrics.get("stress_level", 50)) - 50) * 0.08
        satisfaction_adjustment = (50 - clamp(metrics.get("job_satisfaction", 50))) * 0.06
        completion_adjustment = (70 - clamp(metrics.get("completion_rate", 70))) * 0.05
        leave_days = float(metrics.get("leave_days", 0))
        leave_adjustment = 2 if leave_days <= 1 else -3 if leave_days >= 5 else 0
        score = clamp(base_score + stress_adjustment + satisfaction_adjustment + completion_adjustment + leave_adjustment)
        risk = risk_level(score)
    else:
        risk = str(risk)

    drivers = build_drivers(metrics, sentiment)
    top_driver = max(drivers, key=lambda driver: driver.weighted)

    return PredictionResult(
        score=round(score),
        risk=risk,
        sentiment=sentiment,
        top_driver=top_driver,
        drivers=drivers,
        recommendations=build_recommendations(metrics, score, risk, sentiment),
    )


if __name__ == "__main__":
    sample = {
        "work_hours": 9.5,
        "overtime_hours": 2,
        "task_load": 82,
        "meeting_hours": 11,
        "leave_days": 1,
        "completion_rate": 72,
        "job_satisfaction": 44,
        "stress_level": 70,
        "feedback": "I feel overwhelmed and exhausted because deadlines keep increasing.",
    }
    print(predict_burnout(sample).to_dict())
